"""Applying graded reviews to a memory item, and replaying its whole history (brief Phase 4).

Pure. The ingest path applies one review at a time with ``apply_review``; the replay command
folds the same function over the item's full log. Because both use one function, and every
input (grade, time, learner time zone, desired retention, the deterministic fuzz draw) is in the
log or the learner's settings, replaying a learner's log reproduces ``memory_state`` exactly.

Desired retention enters only the due date. When a learner changes it, every due date is
re-derived from the stored stability (``reschedule``), so replay with the current setting still
equals what is stored.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from typing import Final

from app.domain.fsrs import (
    DEFAULT_WEIGHTS,
    SCHEDULER_VERSION,
    Grade,
    MemoryState,
    Weights,
    fuzz_unit,
    next_interval,
    review,
)
from app.domain.mastery import ItemHistory, MasteryState, classify
from app.domain.streaks import local_day

LAPSE_WINDOW: Final = timedelta(days=30)


@dataclass(frozen=True, slots=True)
class LoggedReview:
    """One review_log row, as replay needs it."""

    ts: datetime
    grade: int
    item_id: str
    type_id: str
    #: the log row's id: reviews at the same instant replay in the order they were applied
    order: str = ""


@dataclass(frozen=True, slots=True)
class ItemState:
    """The derived state of one memory item (one memory_state row, minus bookkeeping)."""

    stability: float
    difficulty: float
    due: datetime
    last_review: datetime
    last_review_day: date
    reviews_today: int
    reps: int
    lapses: int
    lapses_last_30_days: int
    state: MasteryState
    last_item_id: str
    last_type_id: str
    scheduler_version: str = SCHEDULER_VERSION
    #: lapse times within the window, newest last (not stored; carried through a replay)
    recent_lapses: tuple[datetime, ...] = ()


def apply_review(
    prev: ItemState | None,
    entry: LoggedReview,
    *,
    learner_id: str,
    memory_item_id: str,
    tz: str,
    desired_retention: float,
    prior_lapses: Sequence[datetime] = (),
    suspended: bool = False,
    weights: Weights = DEFAULT_WEIGHTS,
) -> ItemState:
    """The state after one more review. ``prior_lapses`` are lapse times already known for the
    item (from the log) when ``prev`` does not carry them, e.g. on the incremental path."""
    grade = Grade(entry.grade)
    day = local_day(entry.ts, tz)
    if prev is None:
        memory = review(None, grade, 0.0, weights=weights)
        reps, lapses, reviews_today = 1, int(grade == Grade.AGAIN), 1
        recent = [entry.ts] if grade == Grade.AGAIN else []
    else:
        same_day = day == prev.last_review_day
        elapsed = max((entry.ts - prev.last_review).total_seconds() / 86_400, 0.0)
        memory = review(
            MemoryState(prev.stability, prev.difficulty),
            grade,
            elapsed,
            same_day=same_day,
            weights=weights,
        )
        reps = prev.reps + 1
        lapses = prev.lapses + int(grade == Grade.AGAIN)
        reviews_today = prev.reviews_today + 1 if same_day else 1
        known = list(prev.recent_lapses) if prev.recent_lapses else list(prior_lapses)
        recent = [*known, entry.ts] if grade == Grade.AGAIN else known
    window = [t for t in recent if entry.ts - t < LAPSE_WINDOW]
    state = classify(
        ItemHistory(
            stability=memory.stability,
            difficulty=memory.difficulty,
            reviews=reps,
            lapses_last_30_days=len(window),
            suspended=suspended,
        )
    )
    days = next_interval(
        memory,
        desired_retention=desired_retention,
        fuzz=fuzz_unit(learner_id, memory_item_id, str(reps)),
        weights=weights,
    )
    return ItemState(
        stability=memory.stability,
        difficulty=memory.difficulty,
        due=entry.ts + timedelta(days=days),
        last_review=entry.ts,
        last_review_day=day,
        reviews_today=reviews_today,
        reps=reps,
        lapses=lapses,
        lapses_last_30_days=len(window),
        state=state,
        last_item_id=entry.item_id,
        last_type_id=entry.type_id,
        recent_lapses=tuple(window),
    )


def replay(
    entries: Iterable[LoggedReview],
    *,
    learner_id: str,
    memory_item_id: str,
    tz: str,
    desired_retention: float,
    suspended: bool = False,
    weights: Weights = DEFAULT_WEIGHTS,
) -> ItemState | None:
    """Fold the item's whole log, oldest first, into its state."""
    state: ItemState | None = None
    for entry in sorted(entries, key=lambda e: (e.ts, e.order)):
        state = apply_review(
            state,
            entry,
            learner_id=learner_id,
            memory_item_id=memory_item_id,
            tz=tz,
            desired_retention=desired_retention,
            suspended=suspended,
            weights=weights,
        )
    return state


def reschedule(
    state: ItemState,
    *,
    learner_id: str,
    memory_item_id: str,
    desired_retention: float,
    weights: Weights = DEFAULT_WEIGHTS,
) -> ItemState:
    """Re-derive the due date for a new desired retention (stability is unchanged)."""
    days = next_interval(
        MemoryState(state.stability, state.difficulty),
        desired_retention=desired_retention,
        fuzz=fuzz_unit(learner_id, memory_item_id, str(state.reps)),
        weights=weights,
    )
    return replace(state, due=state.last_review + timedelta(days=days))
