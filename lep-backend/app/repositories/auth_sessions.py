"""Sessions and refresh tokens."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, exists, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuthSession, Learner, RefreshToken


@dataclass(frozen=True, slots=True)
class RefreshCandidate:
    """A presented refresh token with its session, locked for the rest of the transaction."""

    token_id: UUID
    token_expires_at: datetime
    token_used_at: datetime | None
    session_id: UUID
    learner_id: UUID
    session_expires_at: datetime
    session_revoked_at: datetime | None
    learner_status: str


@dataclass(frozen=True, slots=True)
class PurgeResult:
    sessions: int
    refresh_tokens: int
    password_resets: int = 0


class AuthSessionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_session(
        self,
        *,
        session_id: UUID,
        learner_id: UUID,
        now: datetime,
        expires_at: datetime,
        user_agent: str | None,
    ) -> None:
        await self._session.execute(
            insert(AuthSession).values(
                id=session_id,
                learner_id=learner_id,
                created_at=now,
                last_used_at=now,
                expires_at=expires_at,
                user_agent=user_agent,
            )
        )

    async def add_refresh_token(
        self,
        *,
        token_id: UUID,
        session_id: UUID,
        token_hash: bytes,
        now: datetime,
        expires_at: datetime,
    ) -> None:
        await self._session.execute(
            insert(RefreshToken).values(
                id=token_id,
                session_id=session_id,
                token_hash=token_hash,
                created_at=now,
                expires_at=expires_at,
            )
        )

    async def lock_for_refresh(self, token_hash: bytes) -> RefreshCandidate | None:
        """Find a token by hash and lock it and its session (``FOR UPDATE``).

        The lock serialises concurrent refreshes of one token: the second waits, then
        sees the token already used, which is exactly the reuse case.
        """
        row = (
            await self._session.execute(
                select(
                    RefreshToken.id,
                    RefreshToken.expires_at,
                    RefreshToken.used_at,
                    AuthSession.id.label("session_id"),
                    AuthSession.learner_id,
                    AuthSession.expires_at.label("session_expires_at"),
                    AuthSession.revoked_at,
                    Learner.status,
                )
                .join(AuthSession, AuthSession.id == RefreshToken.session_id)
                .join(Learner, Learner.id == AuthSession.learner_id)
                .where(RefreshToken.token_hash == token_hash)
                .with_for_update(of=[RefreshToken.__table__, AuthSession.__table__])
            )
        ).one_or_none()
        if row is None:
            return None
        return RefreshCandidate(
            token_id=row.id,
            token_expires_at=row.expires_at,
            token_used_at=row.used_at,
            session_id=row.session_id,
            learner_id=row.learner_id,
            session_expires_at=row.session_expires_at,
            session_revoked_at=row.revoked_at,
            learner_status=row.status,
        )

    async def mark_rotated(self, token_id: UUID, *, used_at: datetime, replaced_by: UUID) -> None:
        await self._session.execute(
            update(RefreshToken)
            .where(RefreshToken.id == token_id)
            .values(used_at=used_at, replaced_by=replaced_by)
        )

    async def touch(self, session_id: UUID, *, at: datetime) -> None:
        await self._session.execute(
            update(AuthSession).where(AuthSession.id == session_id).values(last_used_at=at)
        )

    async def revoke(self, session_id: UUID, *, reason: str, at: datetime) -> bool:
        """Revoke a session once; True if this call revoked it."""
        result = await self._session.execute(
            update(AuthSession)
            .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=at, revoked_reason=reason)
            .returning(AuthSession.id)
        )
        return result.scalar_one_or_none() is not None

    async def revoke_all(
        self, learner_id: UUID, *, reason: str, at: datetime, keep: UUID | None = None
    ) -> int:
        """Revoke every live session of the learner but ``keep``; how many were revoked."""
        conditions = [AuthSession.learner_id == learner_id, AuthSession.revoked_at.is_(None)]
        if keep is not None:
            conditions.append(AuthSession.id != keep)
        result = await self._session.execute(
            update(AuthSession)
            .where(*conditions)
            .values(revoked_at=at, revoked_reason=reason)
            .returning(AuthSession.id)
        )
        return len(result.all())

    async def session_for_refresh_token(self, token_hash: bytes) -> UUID | None:
        return (
            await self._session.execute(
                select(RefreshToken.session_id).where(RefreshToken.token_hash == token_hash)
            )
        ).scalar_one_or_none()

    async def is_active(self, *, session_id: UUID, learner_id: UUID, now: datetime) -> bool:
        """The session exists, belongs to the learner, is unexpired and unrevoked, and the
        learner's account is active."""
        return bool(
            await self._session.scalar(
                select(
                    exists().where(
                        AuthSession.id == session_id,
                        AuthSession.learner_id == learner_id,
                        AuthSession.revoked_at.is_(None),
                        AuthSession.expires_at > now,
                        Learner.id == AuthSession.learner_id,
                        Learner.status == "active",
                    )
                )
            )
        )

    async def purge_sessions_before(self, cutoff: datetime, *, batch_size: int) -> int:
        """Delete one batch of sessions that ended (expired or revoked) before ``cutoff``.

        Their refresh tokens go with them (ON DELETE CASCADE).
        """
        doomed = (
            select(AuthSession.id)
            .where(or_(AuthSession.expires_at < cutoff, AuthSession.revoked_at < cutoff))
            .limit(batch_size)
            .scalar_subquery()
        )
        result = await self._session.execute(
            delete(AuthSession).where(AuthSession.id.in_(doomed)).returning(AuthSession.id)
        )
        return len(result.all())

    async def purge_refresh_tokens_before(self, cutoff: datetime, *, batch_size: int) -> int:
        """Delete one batch of refresh tokens that expired before ``cutoff``.

        A used token is kept until it expires, so a replay of it is still recognised as
        reuse; after that it could not be redeemed anyway.
        """
        doomed = (
            select(RefreshToken.id)
            .where(RefreshToken.expires_at < cutoff)
            .limit(batch_size)
            .scalar_subquery()
        )
        result = await self._session.execute(
            delete(RefreshToken).where(RefreshToken.id.in_(doomed)).returning(RefreshToken.id)
        )
        return len(result.all())
