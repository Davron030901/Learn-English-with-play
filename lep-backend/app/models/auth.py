"""Login sessions and rotating refresh tokens.

A session is one sign-in on one device. Each refresh replaces the refresh token and
marks the old one used; presenting a used token again means it was copied, so the
whole session is revoked (reuse detection). Only a SHA-256 of each token is stored —
the tokens are 256-bit random values, so a fast hash is enough and keeps the lookup
indexable.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, LargeBinary, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

REVOCATION_REASONS = ("logout", "refresh_token_reuse", "password_change", "admin")


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[UUID] = mapped_column(primary_key=True)
    learner_id: Mapped[UUID] = mapped_column(ForeignKey("learners.id", ondelete="CASCADE"))
    created_at: Mapped[datetime]
    last_used_at: Mapped[datetime]
    #: Absolute end of the session, however often it is refreshed.
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]
    revoked_reason: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint(
            "(revoked_at IS NULL) = (revoked_reason IS NULL)", name="revocation_complete"
        ),
        CheckConstraint(
            f"revoked_reason IN ({', '.join(repr(r) for r in REVOCATION_REASONS)})",
            name="revoked_reason_valid",
        ),
        CheckConstraint("expires_at > created_at", name="expires_after_creation"),
        CheckConstraint("length(user_agent) <= 256", name="user_agent_length"),
        Index("ix_auth_sessions_learner_id", "learner_id"),
        Index("ix_auth_sessions_expires_at", "expires_at"),
        Index(
            "ix_auth_sessions_revoked_at",
            "revoked_at",
            postgresql_where=text("revoked_at IS NOT NULL"),
        ),
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[UUID] = mapped_column(primary_key=True)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("auth_sessions.id", ondelete="CASCADE"))
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    created_at: Mapped[datetime]
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]
    replaced_by: Mapped[UUID | None] = mapped_column(
        ForeignKey("refresh_tokens.id", ondelete="SET NULL")
    )

    __table_args__ = (
        CheckConstraint("octet_length(token_hash) = 32", name="token_hash_sha256"),
        CheckConstraint("expires_at > created_at", name="expires_after_creation"),
        CheckConstraint("replaced_by IS NULL OR used_at IS NOT NULL", name="replacement_is_use"),
        Index("ix_refresh_tokens_session_id", "session_id"),
        Index("ix_refresh_tokens_expires_at", "expires_at"),
        Index(
            "ix_refresh_tokens_replaced_by",
            "replaced_by",
            postgresql_where=text("replaced_by IS NOT NULL"),
        ),
    )


class PasswordResetToken(Base):
    """A one-time link to set a new password. Only a SHA-256 of the token is stored (it is a
    256-bit random value, like a refresh token); it lasts 30 minutes, works once, and a newer
    request or a successful reset voids every other one the learner holds."""

    __tablename__ = "password_reset_tokens"

    id: Mapped[UUID] = mapped_column(primary_key=True)
    learner_id: Mapped[UUID] = mapped_column(ForeignKey("learners.id", ondelete="CASCADE"))
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    created_at: Mapped[datetime]
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]

    __table_args__ = (
        CheckConstraint("octet_length(token_hash) = 32", name="token_hash_sha256"),
        CheckConstraint("expires_at > created_at", name="expires_after_creation"),
        Index("ix_password_reset_tokens_learner_id", "learner_id"),
        Index("ix_password_reset_tokens_expires_at", "expires_at"),
    )
