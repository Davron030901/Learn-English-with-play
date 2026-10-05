"""Composed learning sessions (docs/08 §5; backend brief §12 ``POST /v1/sessions``).

A session is the plan the composer made: the ordered exercises, why each is there, and the time
it should take. Answers still travel through ``POST /v1/sync/reviews`` with this ``session_id``;
the row only lets the app resume the same plan and the server close it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, SmallInteger, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class LearnerSession(Base):
    __tablename__ = "learner_sessions"

    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(Text)
    minutes: Mapped[int] = mapped_column(SmallInteger)
    node_id: Mapped[str | None] = mapped_column(Text)
    tier: Mapped[int | None] = mapped_column(SmallInteger)
    plan: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime]
    completed_at: Mapped[datetime | None]

    __table_args__ = (
        CheckConstraint("kind IN ('practice', 'node')", name="kind_valid"),
        CheckConstraint("status IN ('open', 'completed')", name="status_valid"),
        CheckConstraint("minutes BETWEEN 1 AND 60", name="minutes_range"),
        CheckConstraint("tier IS NULL OR tier BETWEEN 1 AND 3", name="tier_range"),
        Index("ix_learner_sessions_learner_id_created_at", "learner_id", "created_at"),
    )
