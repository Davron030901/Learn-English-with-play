"""XP (docs/10 §3) and streaks (docs/10 §5): the rules, and the prohibitions as tests."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.domain import streaks, xp
from app.domain.streaks import (
    MAX_FREEZES,
    StreakError,
    StreakState,
    can_repair,
    local_day,
    pause,
    repair,
    reset_message,
    resume,
    settle,
)
from app.domain.xp import ItemEffort, Outcome, SessionMode, item_xp, session_xp

D0 = date(2026, 10, 5)  # a Monday


def days(*offsets: int) -> frozenset[date]:
    return frozenset(D0 + timedelta(days=o) for o in offsets)


# ------------------------------------------------------------------- XP


def test_effort_classes_order_the_base() -> None:
    def one(t: str) -> float:
        return item_xp(ItemEffort(t, Outcome.CORRECT))

    assert one("mcq_word_from_definition") == 1
    assert one("type_from_l1") == 2
    assert one("write_sentence") == 3
    assert one("speak_prompt") == 4


def test_every_exercise_type_has_an_effort_class() -> None:
    from app.content.catalog import TYPE_IDS

    assert set(xp.TYPE_EFFORT) == set(TYPE_IDS)


def test_regrinding_mastered_content_is_worth_a_quarter() -> None:
    fresh = item_xp(ItemEffort("type_from_l1", Outcome.CORRECT))
    regrind = item_xp(ItemEffort("type_from_l1", Outcome.CORRECT, regrind=True))
    assert regrind == fresh * 0.25


def test_too_easy_is_worth_half_and_hard_is_worth_more() -> None:
    assert item_xp(ItemEffort("type_from_l1", Outcome.CORRECT, p_correct=0.97)) == 1
    assert item_xp(ItemEffort("type_from_l1", Outcome.CORRECT, p_correct=0.8)) == 2
    assert item_xp(ItemEffort("type_from_l1", Outcome.CORRECT, p_correct=0.5)) == 3


def test_modes_effort_and_rounding() -> None:
    timed = SessionMode(timed=True, no_hints=True)
    assert item_xp(ItemEffort("mcq_word_from_definition", Outcome.CORRECT), timed) == 1.5625
    assert item_xp(ItemEffort("type_from_l1", Outcome.INCORRECT)) == 1
    assert item_xp(ItemEffort("type_from_l1", Outcome.TIMEOUT)) == 0
    items = [ItemEffort("mcq_word_from_definition", Outcome.CORRECT, regrind=True)] * 6
    assert session_xp(items) == 2  # 1.5 → 2, rounded once per session


def test_immersion_earns_more_than_tapping_through_an_easy_lesson() -> None:
    easy_lesson = session_xp(
        [ItemEffort("mcq_word_from_definition", Outcome.CORRECT, p_correct=0.99)] * 12
    )
    assert xp.reading_xp(1000) > easy_lesson
    assert xp.listening_xp(600) > easy_lesson


# ------------------------------------------------------------------- streak basics


def test_consecutive_days_grow_the_streak_and_hit_milestones() -> None:
    result = settle(StreakState(), through=D0 + timedelta(days=6), counted_days=days(*range(7)))
    assert result.state.current == 7
    assert result.state.longest == 7
    assert result.milestones == (7,)


def test_a_missed_day_uses_a_free_freeze_automatically() -> None:
    result = settle(StreakState(), through=D0 + timedelta(days=3), counted_days=days(0, 1, 3))
    assert result.state.current == 3
    assert result.state.freezes == MAX_FREEZES - 1
    assert [d.status for d in result.days] == ["counted", "counted", "frozen", "counted"]
    assert result.reset_from is None


def test_rest_days_never_break_the_streak_and_never_spend_a_freeze() -> None:
    sunday = 7
    # D0 is Monday; day 6 is Sunday
    result = settle(
        StreakState(),
        through=D0 + timedelta(days=7),
        counted_days=days(0, 1, 2, 3, 4, 5, 7),
        rest_weekdays=frozenset({sunday}),
    )
    assert result.state.current == 7
    assert result.state.freezes == MAX_FREEZES
    assert result.days[6].status == "rest"


def test_with_no_freezes_left_the_streak_resets_kindly() -> None:
    result = settle(StreakState(), through=D0 + timedelta(days=5), counted_days=days(0, 1, 2))
    assert result.state.current == 0
    assert result.reset_from == 3
    msg = reset_message(result.reset_from)
    assert msg == (
        "Your streak reset. That's fine — 3 days of learning didn't disappear. "
        "Ready to start the next one?"
    )
    for banned in ("lose", "disappoint", "sad", "miss", "shame", "hurry"):
        assert banned not in msg.lower()


def test_freezes_regenerate_one_every_five_days_up_to_two() -> None:
    # spend both freezes, then learn every day for ten days
    r = settle(StreakState(), through=D0 + timedelta(days=3), counted_days=days(0, 1))
    assert r.state.freezes == 0
    r = settle(r.state, through=D0 + timedelta(days=8), counted_days=days(*range(4, 9)))
    assert r.state.freezes == 1
    r = settle(r.state, through=D0 + timedelta(days=13), counted_days=days(*range(9, 14)))
    assert r.state.freezes == 2
    r = settle(r.state, through=D0 + timedelta(days=30), counted_days=days(*range(14, 31)))
    assert r.state.freezes == MAX_FREEZES


def test_settling_twice_changes_nothing() -> None:
    counted = days(0, 1, 3, 4)
    once = settle(StreakState(), through=D0 + timedelta(days=4), counted_days=counted)
    twice = settle(once.state, through=D0 + timedelta(days=4), counted_days=counted)
    assert twice.state == once.state
    assert twice.days == ()


# ------------------------------------------------------------------- repair and pause


def _broken() -> StreakState:
    r = settle(StreakState(), through=D0 + timedelta(days=6), counted_days=days(0, 1, 2, 3))
    assert r.state.current == 0
    return r.state


def test_a_broken_streak_can_be_repaired_within_48_hours_once_a_month() -> None:
    state = _broken()
    broke = state.broken_on
    assert broke is not None
    assert can_repair(state, broke + timedelta(days=2))
    assert not can_repair(state, broke + timedelta(days=3))
    repaired = repair(state, broke + timedelta(days=1), double_session_done=True)
    assert repaired.current == 4
    with pytest.raises(StreakError):
        repair(repaired, broke + timedelta(days=1), double_session_done=True)


def test_a_repair_needs_the_double_session() -> None:
    state = _broken()
    assert state.broken_on is not None
    with pytest.raises(StreakError, match="double session"):
        repair(state, state.broken_on, double_session_done=False)


def test_a_pause_protects_up_to_thirty_days_without_spending_freezes() -> None:
    r = settle(StreakState(), through=D0 + timedelta(days=1), counted_days=days(0, 1))
    paused = pause(r.state, D0 + timedelta(days=2), 10)
    later = settle(paused, through=D0 + timedelta(days=12), counted_days=days(12))
    assert later.state.current == 3
    assert later.state.freezes == MAX_FREEZES
    with pytest.raises(StreakError):
        pause(r.state, D0, 31)


def test_resume_ends_a_pause_early() -> None:
    paused = pause(StreakState(current=5, last_counted=D0), D0 + timedelta(days=1), 10)
    resumed = resume(paused, D0 + timedelta(days=3))
    assert resumed.paused_until == D0 + timedelta(days=2)


# ------------------------------------------------------------------- learner-local days


def test_days_are_the_learners_local_calendar_days() -> None:
    moment = datetime(2026, 10, 5, 20, 30, tzinfo=UTC)  # 01:30 next day in Tashkent
    assert local_day(moment, "Asia/Tashkent") == date(2026, 10, 6)
    assert local_day(moment, "America/New_York") == date(2026, 10, 5)


def test_the_local_day_follows_the_clock_change() -> None:
    # Europe/London leaves summer time on 2026-10-25 at 01:00 UTC.
    assert local_day(datetime(2026, 10, 24, 23, 30, tzinfo=UTC), "Europe/London") == date(
        2026, 10, 25
    )  # 00:30 BST
    assert local_day(datetime(2026, 10, 25, 23, 30, tzinfo=UTC), "Europe/London") == date(
        2026, 10, 25
    )  # 23:30 GMT
    assert local_day(datetime(2026, 10, 26, 0, 30, tzinfo=UTC), "Europe/London") == date(
        2026, 10, 26
    )


# ------------------------------------------------------------------- invariants


@given(
    st.lists(st.booleans(), min_size=1, max_size=120),
    st.frozensets(st.integers(min_value=1, max_value=7), max_size=2),
)
@settings(max_examples=500, deadline=None)
def test_invariants_over_any_history(activity: list[bool], rest: frozenset[int]) -> None:
    counted = frozenset(D0 + timedelta(days=i) for i, a in enumerate(activity) if a)
    state = StreakState()
    for i in range(len(activity)):  # settle one day at a time, as the nightly job does
        r = settle(state, through=D0 + timedelta(days=i), counted_days=counted, rest_weekdays=rest)
        assert 0 <= r.state.freezes <= MAX_FREEZES
        assert r.state.current <= r.state.longest
        if r.state.current < state.current:
            assert r.reset_from == state.current
            assert r.state.current == 0
        state = r.state
    whole = settle(
        StreakState(),
        through=D0 + timedelta(days=len(activity) - 1),
        counted_days=counted,
        rest_weekdays=rest,
    )
    assert whole.state.current == state.current
    assert whole.state.longest == state.longest


def test_there_is_no_way_to_buy_a_freeze() -> None:
    names = {n.lower() for n in dir(streaks)}
    for banned in ("buy", "purchase", "gem", "price", "shop"):
        assert not any(banned in n for n in names)


def test_more_than_two_rest_days_are_refused() -> None:
    with pytest.raises(StreakError):
        settle(StreakState(), through=D0, counted_days=days(0), rest_weekdays=frozenset({1, 2, 3}))
