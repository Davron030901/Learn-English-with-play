"""Checkpoints (test-out) and placement (backend brief Phase 7, docs/12 §2–§3, docs/10 §4)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, Float, ForeignKey, SmallInteger, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Checkpoint(Base):
    """A unit test-out: free, unlimited, ≥ 85 % passes (docs/10 §4). Its answers arrive through
    the ordinary review sync with ``session_id`` = the checkpoint's id, so they schedule memory
    items like any other answer."""

    __tablename__ = "checkpoints"

    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    unit_id: Mapped[str] = mapped_column(Text)
    item_ids: Mapped[list[str]] = mapped_column(ARRAY(Text))
    created_at: Mapped[datetime]
    completed_at: Mapped[datetime | None]
    passed: Mapped[bool | None]
    accuracy: Mapped[float | None] = mapped_column(Float)


class Placement(Base):
    """An adaptive placement: a search over the ten sub-levels, five items a stage."""

    __tablename__ = "placements"

    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    lo: Mapped[int] = mapped_column(SmallInteger)
    hi: Mapped[int] = mapped_column(SmallInteger)
    stage_level: Mapped[int | None] = mapped_column(SmallInteger)
    stage_items: Mapped[list[str]] = mapped_column(ARRAY(Text))
    history: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    created_at: Mapped[datetime]
    result_level: Mapped[int | None] = mapped_column(SmallInteger)

    __table_args__ = (
        CheckConstraint("lo BETWEEN 0 AND 10 AND hi BETWEEN -1 AND 9", name="bounds_range"),
    )
