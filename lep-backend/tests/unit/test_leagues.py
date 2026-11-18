"""The league rules (docs/16 E23) and display names, without a database."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.domain import leagues as lg
from app.domain.display_names import InvalidDisplayName, normalise_display_name

T0 = datetime(2026, 10, 5, 9, 0, tzinfo=UTC)


# ------------------------------------------------------------------- the week


def test_the_week_ends_on_sunday_at_20_00_in_tashkent_for_everyone() -> None:
    week = lg.week_of(datetime(2026, 10, 7, 12, 0, tzinfo=UTC))  # a Wednesday
    assert week.ends_at == datetime(2026, 10, 11, 15, 0, tzinfo=UTC)  # Sunday 20:00 UTC+5
    assert week.starts_at == datetime(2026, 10, 4, 15, 0, tzinfo=UTC)
    assert week.last_day.isoweekday() == 7


@pytest.mark.parametrize(
    ("at", "ends"),
    [
        # one second before the end is still the old week; the end itself starts the next
        (datetime(2026, 10, 11, 14, 59, 59, tzinfo=UTC), datetime(2026, 10, 11, 15, tzinfo=UTC)),
        (datetime(2026, 10, 11, 15, 0, tzinfo=UTC), datetime(2026, 10, 18, 15, tzinfo=UTC)),
        # Sunday morning in Tashkent is still before the end
        (datetime(2026, 10, 11, 3, 0, tzinfo=UTC), datetime(2026, 10, 11, 15, tzinfo=UTC)),
        # Sunday night in Tashkent belongs to the next week
        (datetime(2026, 10, 11, 18, 0, tzinfo=UTC), datetime(2026, 10, 18, 15, tzinfo=UTC)),
    ],
)
def test_week_boundaries(at: datetime, ends: datetime) -> None:
    week = lg.week_of(at)
    assert week.ends_at == ends
    assert week.starts_at <= at < week.ends_at
    assert week.ends_at - week.starts_at == lg.WEEK


def test_the_previous_week_is_the_seven_days_before() -> None:
    week = lg.week_of(T0)
    before = lg.previous(week)
    assert before.ends_at == week.starts_at
    assert lg.week_of(week.starts_at - timedelta(seconds=1)) == before


# ------------------------------------------------------------------- grouping


def test_band_is_plus_or_minus_half_of_the_seed() -> None:
    assert lg.in_band(100, 50)
    assert lg.in_band(100, 150)
    assert not lg.in_band(100, 49)
    assert not lg.in_band(100, 151)
    assert lg.in_band(0, 0)
    assert not lg.in_band(0, 1)


def test_a_learner_joins_the_group_in_their_band() -> None:
    groups = [lg.Group("low", 20, 10), lg.Group("high", 400, 3)]
    assert lg.choose_group(groups, 380) == groups[1]
    assert lg.choose_group(groups, 25) == groups[0]


def test_out_of_band_the_nearest_group_with_room_rather_than_racing_alone() -> None:
    groups = [lg.Group("a", 100, 5), lg.Group("b", 1_000, 5)]
    assert lg.choose_group(groups, 2_500) == groups[1]


def test_full_groups_are_skipped_and_none_means_start_a_new_one() -> None:
    full = lg.Group("full", 100, lg.LEAGUE_SIZE)
    assert lg.choose_group([full], 100) is None
    assert lg.choose_group([full, lg.Group("open", 900, 1)], 100) == lg.Group("open", 900, 1)
    assert lg.choose_group([], 0) is None


def test_among_equal_groups_the_fuller_one_fills_first() -> None:
    groups = [lg.Group("a", 100, 4), lg.Group("b", 100, 9)]
    assert lg.choose_group(groups, 100) == groups[1]


# ------------------------------------------------------------------- settlement


def _entries(n: int, *, paused: frozenset[int] = frozenset()) -> list[lg.Entry]:
    # learner i has (n - i) * 100 XP, so ranks follow i
    return [lg.Entry(i, (n - i) * 100, T0 + timedelta(minutes=i), i in paused) for i in range(n)]


def test_a_full_group_moves_seven_up_and_five_down() -> None:
    s = lg.standings(5, _entries(30))
    assert [x.moved for x in s[:7]] == [1] * 7
    assert all(x.moved == 0 for x in s[7:25])
    assert [x.moved for x in s[25:]] == [-1] * 5
    assert [x.rank for x in s] == list(range(1, 31))


@pytest.mark.parametrize("tier", [1, 2])
def test_tiers_1_and_2_never_move_down(tier: int) -> None:
    s = lg.standings(tier, _entries(30))
    assert not any(x.moved < 0 for x in s)
    assert sum(x.moved for x in s) == 7


def test_the_top_tier_has_no_promotion() -> None:
    s = lg.standings(lg.TIERS, _entries(30))
    assert not any(x.moved > 0 for x in s)
    assert sum(1 for x in s if x.moved < 0) == 5


def test_a_small_group_never_demotes_its_top_seven() -> None:
    s = lg.standings(4, _entries(10))
    assert [x.moved for x in s] == [1] * 7 + [-1] * 3
    s = lg.standings(4, _entries(5))
    assert [x.moved for x in s] == [1] * 5


def test_no_xp_no_promotion() -> None:
    s = lg.standings(1, [lg.Entry("idle", 0, T0)])
    assert s[0].zone is None
    assert s[0].moved == 0


def test_a_paused_learner_has_no_movement_but_keeps_their_place() -> None:
    s = lg.standings(5, _entries(30, paused=frozenset({0, 29})))
    assert (s[0].rank, s[0].zone, s[0].moved) == (1, "up", 0)
    assert (s[-1].zone, s[-1].moved) == ("down", 0)


def test_equal_xp_ranks_whoever_joined_first_higher() -> None:
    s = lg.standings(
        1, [lg.Entry("late", 500, T0 + timedelta(hours=1)), lg.Entry("early", 500, T0)]
    )
    assert [x.learner_id for x in s] == ["early", "late"]


def test_the_tier_stays_between_1_and_10() -> None:
    assert lg.tier_after(1, -1) == 1
    assert lg.tier_after(10, 1) == 10
    assert lg.tier_after(4, 1) == 5


def test_leaving_keeps_the_tier_for_four_weeks() -> None:
    assert lg.tier_on_return(6, T0, T0 + timedelta(weeks=4)) == 6
    assert lg.tier_on_return(6, T0, T0 + timedelta(weeks=4, seconds=1)) == 1
    assert lg.tier_on_return(6, None, T0) == 6


def test_whole_xp_rounds_half_up() -> None:
    assert lg.xp(149) == 1
    assert lg.xp(150) == 2
    assert lg.xp(0) == 0


# ------------------------------------------------------------------- display names


@pytest.mark.parametrize(
    ("raw", "name"),
    [
        ("  Aziz   Karimov ", "Aziz Karimov"),
        ("O\u02bbg\u02bbiloy", "O\u02bbg\u02bbiloy"),
        (
            "\u0414\u0438\u043b\u043d\u043e\u0437\u0430",
            "\u0414\u0438\u043b\u043d\u043e\u0437\u0430",
        ),
        ("pip_fan-7", "pip_fan-7"),
        ("O'tkir", "O'tkir"),
        ("\uff26\uff55\uff4c\uff4c", "Full"),  # NFKC folds full-width letters
    ],
)
def test_display_names_are_normalised(raw: str, name: str) -> None:
    assert normalise_display_name(raw) == name


@pytest.mark.parametrize(
    "raw",
    [
        "a",
        "x" * 25,
        "me@example.com",
        "site.com",
        "12345",
        "--",
        "\u02bb\u02bb",  # modifier letters only
        "abc\u202edef",  # a direction override
        "zero\u200bwidth",  # a zero-width space is a format character, not whitespace
    ],
)
def test_display_names_that_are_refused(raw: str) -> None:
    with pytest.raises(InvalidDisplayName):
        normalise_display_name(raw)
