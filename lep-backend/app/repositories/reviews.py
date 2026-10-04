"""Persistence for the review pipeline. SQL only; the rules live in the service and the domain."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.mastery import MasteryState
from app.domain.scheduling import ItemState, LoggedReview
from app.models.review import (
    AnswerDispute,
    MemoryState,
    ReviewAttempt,
    ReviewIngestKey,
    ReviewLog,
)


@dataclass(frozen=True, slots=True)
class StoredKey:
    client_uuid: UUID
    kind: str
    verdict: str | None
    grade: int | None


@dataclass(frozen=True, slots=True)
class StoredState:
    item: ItemState
    suspended: bool


class ReviewRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def lock_learner(self, learner_id: UUID) -> None:
        """Serialise ingest per learner (two devices syncing at once) for this transaction."""
        await self._session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": f"review-ingest:{learner_id}"},
        )

    async def existing_keys(
        self, learner_id: UUID, client_uuids: Sequence[UUID]
    ) -> dict[UUID, StoredKey]:
        if not client_uuids:
            return {}
        rows = await self._session.execute(
            select(
                ReviewIngestKey.client_uuid,
                ReviewIngestKey.kind,
                ReviewIngestKey.verdict,
                ReviewIngestKey.grade,
            ).where(
                ReviewIngestKey.learner_id == learner_id,
                ReviewIngestKey.client_uuid.in_(client_uuids),
            )
        )
        return {r.client_uuid: StoredKey(r.client_uuid, r.kind, r.verdict, r.grade) for r in rows}

    async def states(
        self, learner_id: UUID, memory_item_ids: Iterable[str]
    ) -> dict[str, StoredState]:
        ids = sorted(set(memory_item_ids))
        if not ids:
            return {}
        rows = await self._session.execute(
            select(MemoryState).where(
                MemoryState.learner_id == learner_id, MemoryState.memory_item_id.in_(ids)
            )
        )
        out: dict[str, StoredState] = {}
        for (m,) in rows:
            out[m.memory_item_id] = StoredState(
                item=ItemState(
                    stability=m.stability,
                    difficulty=m.difficulty,
                    due=m.due,
                    last_review=m.last_review,
                    last_review_day=m.last_review_day,
                    reviews_today=m.reviews_today,
                    reps=m.reps,
                    lapses=m.lapses,
                    lapses_last_30_days=m.lapses_last_30_days,
                    state=MasteryState(m.state),
                    last_item_id=m.last_item_id,
                    last_type_id=m.last_type_id,
                    scheduler_version=m.scheduler_version,
                ),
                suspended=m.suspended,
            )
        return out

    async def lapse_times(
        self, learner_id: UUID, memory_item_ids: Iterable[str], since: datetime
    ) -> dict[str, list[datetime]]:
        """Lapses (grade 1) per memory item since ``since``, oldest first."""
        ids = sorted(set(memory_item_ids))
        out: dict[str, list[datetime]] = defaultdict(list)
        if not ids:
            return out
        rows = await self._session.execute(
            select(ReviewLog.memory_item_id, ReviewLog.ts)
            .where(
                ReviewLog.learner_id == learner_id,
                ReviewLog.memory_item_id.in_(ids),
                ReviewLog.grade == 1,
                ReviewLog.ts >= since,
            )
            .order_by(ReviewLog.ts, ReviewLog.id)
        )
        for r in rows:
            out[r.memory_item_id].append(r.ts)
        return out

    async def history(
        self, learner_id: UUID, memory_item_ids: Iterable[str]
    ) -> dict[str, list[LoggedReview]]:
        """The full log of each memory item, oldest first (replay)."""
        ids = sorted(set(memory_item_ids))
        out: dict[str, list[LoggedReview]] = defaultdict(list)
        if not ids:
            return out
        rows = await self._session.execute(
            select(
                ReviewLog.memory_item_id,
                ReviewLog.ts,
                ReviewLog.id,
                ReviewLog.grade,
                ReviewLog.item_id,
                ReviewLog.type_id,
            )
            .where(ReviewLog.learner_id == learner_id, ReviewLog.memory_item_id.in_(ids))
            .order_by(ReviewLog.ts, ReviewLog.id)
        )
        for r in rows:
            out[r.memory_item_id].append(
                LoggedReview(
                    ts=r.ts, grade=r.grade, item_id=r.item_id, type_id=r.type_id, order=str(r.id)
                )
            )
        return out

    async def all_memory_item_ids(self, learner_id: UUID) -> list[str]:
        rows = await self._session.execute(
            select(ReviewLog.memory_item_id)
            .where(ReviewLog.learner_id == learner_id)
            .group_by(ReviewLog.memory_item_id)
        )
        return [r.memory_item_id for r in rows]

    async def insert_attempt(self, values: dict[str, Any]) -> None:
        await self._session.execute(insert(ReviewAttempt).values(values))

    async def insert_log_rows(self, rows: list[dict[str, Any]]) -> None:
        if rows:
            await self._session.execute(insert(ReviewLog).values(rows))

    async def insert_key(self, values: dict[str, Any]) -> None:
        await self._session.execute(insert(ReviewIngestKey).values(values))

    async def insert_dispute(self, values: dict[str, Any]) -> None:
        await self._session.execute(
            insert(AnswerDispute)
            .values(values)
            .on_conflict_do_nothing(
                index_elements=[AnswerDispute.learner_id, AnswerDispute.client_uuid]
            )
        )

    async def upsert_state(self, learner_id: UUID, memory_item_id: str, s: ItemState) -> None:
        values = {
            "learner_id": learner_id,
            "memory_item_id": memory_item_id,
            "stability": s.stability,
            "difficulty": s.difficulty,
            "due": s.due,
            "last_review": s.last_review,
            "last_review_day": s.last_review_day,
            "reviews_today": s.reviews_today,
            "reps": s.reps,
            "lapses": s.lapses,
            "lapses_last_30_days": s.lapses_last_30_days,
            "state": s.state.value,
            "last_item_id": s.last_item_id,
            "last_type_id": s.last_type_id,
            "scheduler_version": s.scheduler_version,
        }
        stmt = insert(MemoryState).values(values)
        update = {k: stmt.excluded[k] for k in values if k not in ("learner_id", "memory_item_id")}
        await self._session.execute(
            stmt.on_conflict_do_update(
                index_elements=[MemoryState.learner_id, MemoryState.memory_item_id], set_=update
            )
        )

    async def due_count(self, learner_id: UUID, now: datetime) -> int:
        result = await self._session.execute(
            select(func.count())
            .select_from(MemoryState)
            .where(
                MemoryState.learner_id == learner_id,
                MemoryState.due <= now,
                MemoryState.state.notin_(("suspended", "retired")),
            )
        )
        return int(result.scalar_one())
