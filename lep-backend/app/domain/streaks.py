"""Streaks, with the cruelty removed (docs/10 §5, backend brief §9.2). Pure.

Days are the learner's **local calendar days** (their IANA zone, DST included); the caller
converts timestamps with ``local_day``. A day *counts* when the learner did scheduled work that
day (the service decides what qualifies — by default, any completed session or the daily goal).

What protects a streak, in the order it is applied to each missed day:

1. a **pause** (self-declared, up to 30 days, no questions asked) — the day is simply skipped;
2. a **rest day** (up to 2 learner-designated weekdays) — skipped, never breaks anything;
3. a **freeze** — free and automatic, 2 held at all times, one regenerating every 5 days. There
   is no purchase path, ever (backend brief §9.3);
4. otherwise the streak resets — and can be **repaired** within 48 hours by a double session,
   free, once per calendar month.

Protected days keep the streak alive but do not add to it. A streak is never a gate on content,
a leaderboard input or a certificate condition — nothing outside this module reads it except
the display. The reset message is fixed by the spec and never guilt-toned.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from typing import Final
from zoneinfo import ZoneInfo

MAX_FREEZES: Final = 2
FREEZE_REGEN_DAYS: Final = 5
MAX_REST_DAYS: Final = 2
REPAIR_WINDOW_DAYS: Final = 2  # 48 hours, counted in local days after the day it broke
MAX_PAUSE_DAYS: Final = 30
MILESTONES: Final = (7, 30, 100, 365)


def local_day(moment: datetime, tz: str) -> date:
    """The learner's calendar day at ``moment`` (an aware datetime)."""
    if moment.tzinfo is None:
        raise ValueError("moment must be timezone-aware")
    return moment.astimezone(ZoneInfo(tz)).date()


def reset_message(days: int) -> str:
    """docs/10 §5, verbatim apart from the number. Never guilt, never disappointment."""
    unit = "day" if days == 1 else "days"
    return (
        f"Your streak reset. That's fine — {days} {unit} of learning didn't disappear. "
        "Ready to start the next one?"
    )


class StreakError(ValueError):
    """A request the rules do not allow (with a reason the app can show)."""


@dataclass(frozen=True, slots=True)
class StreakState:
    current: int = 0
    longest: int = 0
    #: the last local day that counted
    last_counted: date | None = None
    #: the last local day the rules have been applied up to (inclusive)
    settled_through: date | None = None
    freezes: int = MAX_FREEZES
    #: the day the freeze-regeneration clock last started
    freeze_clock: date | None = None
    paused_from: date | None = None
    paused_until: date | None = None  # inclusive
    #: set when a streak broke and might still be repaired
    broken_on: date | None = None
    broken_length: int = 0
    #: "YYYY-MM" of the last repair (once per calendar month)
    repaired_month: str | None = None


@dataclass(frozen=True, slots=True)
class DayOutcome:
    day: date
    #: "counted"; "idle" (no streak to protect); "paused", "rest", "frozen" (protected);
    #: "broken"
    status: str


@dataclass(frozen=True, slots=True)
class Settlement:
    state: StreakState
    days: tuple[DayOutcome, ...]
    #: the streak length lost if it broke during this settlement (for the reset message)
    reset_from: int | None = None
    #: milestones newly reached (7, 30, 100, 365)
    milestones: tuple[int, ...] = ()


def _validate_rest_days(rest_weekdays: frozenset[int]) -> None:
    if len(rest_weekdays) > MAX_REST_DAYS or not all(1 <= d <= 7 for d in rest_weekdays):
        raise StreakError("choose at most two rest days (ISO weekdays 1–7)")


def _paused(state: StreakState, day: date) -> bool:
    return (
        state.paused_from is not None
        and state.paused_until is not None
        and state.paused_from <= day <= state.paused_until
    )


def _regenerate(state: StreakState, day: date) -> StreakState:
    """One freeze back for every 5 days since the clock started, up to the cap."""
    if state.freeze_clock is None:
        return replace(state, freeze_clock=day)
    if state.freezes >= MAX_FREEZES:
        return replace(state, freeze_clock=day)
    elapsed = (day - state.freeze_clock).days
    earned = elapsed // FREEZE_REGEN_DAYS
    if earned <= 0:
        return state
    freezes = min(MAX_FREEZES, state.freezes + earned)
    clock = (
        day
        if freezes >= MAX_FREEZES
        else state.freeze_clock + timedelta(days=earned * FREEZE_REGEN_DAYS)
    )
    return replace(state, freezes=freezes, freeze_clock=clock)


def settle(
    state: StreakState,
    *,
    through: date,
    counted_days: frozenset[date],
    rest_weekdays: frozenset[int] = frozenset(),
) -> Settlement:
    """Apply the rules to every day after ``settled_through`` up to and including ``through``.

    ``counted_days`` holds the local days with qualifying work (only those in the window
    matter). Call with ``through`` = yesterday at the learner's day roll-over, and with
    ``through`` = today whenever today starts to count. Idempotent: settling the same window
    twice changes nothing.
    """
    _validate_rest_days(rest_weekdays)
    start = (state.settled_through + timedelta(days=1)) if state.settled_through else None
    if start is None:
        # a new streak record: begin at the first counted day in the window (or today)
        first = min((d for d in counted_days if d <= through), default=through)
        start = first
    if start > through:
        return Settlement(state, ())

    outcomes: list[DayOutcome] = []
    reset_from: int | None = None
    milestones: list[int] = []
    s = state
    day = start
    while day <= through:
        s = _regenerate(s, day)
        if day in counted_days:
            before = s.current
            current = before + 1
            s = replace(
                s,
                current=current,
                longest=max(s.longest, current),
                last_counted=day,
                broken_on=(
                    None
                    if s.broken_on and day > s.broken_on + timedelta(days=REPAIR_WINDOW_DAYS)
                    else s.broken_on
                ),
            )
            milestones.extend(m for m in MILESTONES if before < m <= current)
            outcomes.append(DayOutcome(day, "counted"))
        elif s.current == 0:
            # nothing to protect: an empty day before any streak simply passes
            outcomes.append(DayOutcome(day, "idle"))
        elif _paused(s, day):
            outcomes.append(DayOutcome(day, "paused"))
        elif day.isoweekday() in rest_weekdays:
            outcomes.append(DayOutcome(day, "rest"))
        elif s.freezes > 0:
            s = replace(s, freezes=s.freezes - 1, freeze_clock=s.freeze_clock or day)
            outcomes.append(DayOutcome(day, "frozen"))
        else:
            reset_from = s.current
            s = replace(s, current=0, broken_on=day, broken_length=reset_from)
            outcomes.append(DayOutcome(day, "broken"))
        s = replace(s, settled_through=day)
        day += timedelta(days=1)
    return Settlement(s, tuple(outcomes), reset_from, tuple(milestones))


def can_repair(state: StreakState, today: date) -> bool:
    if state.broken_on is None or state.broken_length == 0:
        return False
    if today > state.broken_on + timedelta(days=REPAIR_WINDOW_DAYS):
        return False
    return state.repaired_month != today.strftime("%Y-%m")


def repair(state: StreakState, today: date, *, double_session_done: bool) -> StreakState:
    """Restore a broken streak: within 48 h, by a double session, free, once a month.

    The streak comes back at its length before the break, plus whatever has counted since.
    """
    if not can_repair(state, today):
        raise StreakError("this streak can no longer be repaired")
    if not double_session_done:
        raise StreakError("a repair needs a double session today")
    restored = state.broken_length + state.current
    return replace(
        state,
        current=restored,
        longest=max(state.longest, restored),
        broken_on=None,
        broken_length=0,
        repaired_month=today.strftime("%Y-%m"),
    )


def pause(state: StreakState, today: date, days: int) -> StreakState:
    """Pause for illness or a holiday: up to 30 days from today, no questions asked."""
    if not 1 <= days <= MAX_PAUSE_DAYS:
        raise StreakError(f"a pause lasts 1 to {MAX_PAUSE_DAYS} days")
    if _paused(state, today):
        raise StreakError("the streak is already paused")
    return replace(state, paused_from=today, paused_until=today + timedelta(days=days - 1))


def resume(state: StreakState, today: date) -> StreakState:
    """End a pause early (today is no longer paused)."""
    if not _paused(state, today):
        return state
    end = today - timedelta(days=1)
    if state.paused_from is not None and end < state.paused_from:
        return replace(state, paused_from=None, paused_until=None)
    return replace(state, paused_until=end)
