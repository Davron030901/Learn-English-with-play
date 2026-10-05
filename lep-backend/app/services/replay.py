"""Rebuild a learner's memory state from the review log alone (backend brief Phase 4).

``memory_state`` is derived data. Replaying ``review_log`` with the learner's current time zone
and desired retention must reproduce it exactly; ``replay_learner`` reports every item where it
does not ("drift"), and with ``write=True`` repairs them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.scheduling import ItemState, replay
from app.repositories.learners import LearnerRepository
from app.repositories.reviews import ReviewRepository


@dataclass(slots=True)
class ReplayReport:
    learner_id: UUID
    items: int = 0
    drift: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    repaired: int = 0


def _same(a: ItemState, b: ItemState) -> bool:
    return (
        a.stability == b.stability
        and a.difficulty == b.difficulty
        and a.due == b.due
        and a.last_review == b.last_review
        and a.last_review_day == b.last_review_day
        and a.reviews_today == b.reviews_today
        and a.reps == b.reps
        and a.lapses == b.lapses
        and a.lapses_last_30_days == b.lapses_last_30_days
        and a.state == b.state
        and a.last_item_id == b.last_item_id
        and a.last_type_id == b.last_type_id
    )


async def replay_learner(
    session: AsyncSession, learner_id: UUID, *, write: bool = False
) -> ReplayReport:
    """Run inside a transaction the caller owns."""
    report = ReplayReport(learner_id)
    profile = await LearnerRepository(session).profile(learner_id)
    if profile is None:
        return report
    repo = ReviewRepository(session)
    ids = await repo.all_memory_item_ids(learner_id)
    stored = await repo.states(learner_id, ids)
    history = await repo.history(learner_id, ids)
    report.items = len(ids)
    for m in ids:
        current = stored.get(m)
        derived = replay(
            history.get(m, []),
            learner_id=str(learner_id),
            memory_item_id=m,
            tz=profile.tz,
            desired_retention=float(profile.desired_retention),
            suspended=current.suspended if current else False,
        )
        if derived is None:
            continue
        if current is None:
            report.missing.append(m)
        elif not _same(current.item, derived):
            report.drift.append(m)
        else:
            continue
        if write:
            await repo.upsert_state(learner_id, m, derived)
            report.repaired += 1
    return report
