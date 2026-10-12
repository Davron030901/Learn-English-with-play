"""Password reset tokens: only their SHA-256 is stored."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PasswordResetToken


@dataclass(frozen=True, slots=True)
class ResetCandidate:
    id: UUID
    learner_id: UUID
    expires_at: datetime
    used_at: datetime | None


class PasswordResetRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(
        self,
        *,
        token_id: UUID,
        learner_id: UUID,
        token_hash: bytes,
        now: datetime,
        expires_at: datetime,
    ) -> None:
        await self._session.execute(
            insert(PasswordResetToken).values(
                id=token_id,
                learner_id=learner_id,
                token_hash=token_hash,
                created_at=now,
                expires_at=expires_at,
                used_at=None,
            )
        )

    async def void_all(self, learner_id: UUID, *, at: datetime) -> None:
        """Mark every unused link of the learner as used: only the newest may work."""
        await self._session.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.learner_id == learner_id, PasswordResetToken.used_at.is_(None)
            )
            .values(used_at=at)
        )

    async def lock(self, token_hash: bytes) -> ResetCandidate | None:
        row = (
            await self._session.execute(
                select(
                    PasswordResetToken.id,
                    PasswordResetToken.learner_id,
                    PasswordResetToken.expires_at,
                    PasswordResetToken.used_at,
                )
                .where(PasswordResetToken.token_hash == token_hash)
                .with_for_update()
            )
        ).one_or_none()
        if row is None:
            return None
        return ResetCandidate(
            id=row.id, learner_id=row.learner_id, expires_at=row.expires_at, used_at=row.used_at
        )

    async def purge_before(self, cutoff: datetime, *, batch_size: int) -> int:
        """Delete one batch of links that expired before ``cutoff``."""
        doomed = (
            select(PasswordResetToken.id)
            .where(PasswordResetToken.expires_at < cutoff)
            .limit(batch_size)
            .scalar_subquery()
        )
        result = await self._session.execute(
            delete(PasswordResetToken)
            .where(PasswordResetToken.id.in_(doomed))
            .returning(PasswordResetToken.id)
        )
        return len(result.all())
