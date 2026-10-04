"""The review pipeline (backend brief Phase 4, docs/ERD.md).

* ``review_ingest_keys`` — idempotency: one row per (learner, client_uuid) ever accepted.
* ``review_attempts`` — one row per answer, append-only, monthly partitions on ``ts``.
* ``review_log`` — one row per memory item an answer touched, append-only, monthly partitions;
  this is all a replay reads.
* ``memory_state`` — the FSRS state per (learner, memory item), derived from the log and
  rebuildable from it at any time; 64 hash partitions on the learner.
* ``answer_disputes`` — "I think my answer was right": content review, never a re-grade.

Append-only is enforced by the database (triggers that raise on UPDATE, DELETE and TRUNCATE,
plus INSERT/SELECT-only grants), not by the ORM. The one path that may delete is erasure, which
sets ``lep.erasure = 'on'`` in its own transaction.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

VERDICTS = ("correct", "incorrect", "ungraded")
MEMORY_STATES = (
    "learning",
    "young",
    "retained",
    "durable",
    "leech",
    "suspended",
    "retired",
)
DISPUTE_STATUSES = ("open", "upheld", "rejected")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class ReviewIngestKey(Base):
    __tablename__ = "review_ingest_keys"

    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    client_uuid: Mapped[UUID] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(Text)
    #: the attempt this key produced (null for a dispute)
    attempt_ts: Mapped[datetime | None]
    attempt_id: Mapped[UUID | None]
    #: the verdict returned the first time, so a retried request gets the same answer
    verdict: Mapped[str | None] = mapped_column(Text)
    grade: Mapped[int | None] = mapped_column(SmallInteger)
    ingested_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (
        CheckConstraint("kind IN ('review', 'dispute')", name="kind_valid"),
        CheckConstraint(f"verdict IS NULL OR {_in('verdict', VERDICTS)}", name="verdict_valid"),
        CheckConstraint("grade IS NULL OR grade BETWEEN 1 AND 4", name="grade_range"),
    )


class ReviewAttempt(Base):
    __tablename__ = "review_attempts"

    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    #: when the learner answered (the device's clock, clamped to the server's)
    ts: Mapped[datetime] = mapped_column(primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    client_uuid: Mapped[UUID]
    item_id: Mapped[str] = mapped_column(Text)
    type_id: Mapped[str] = mapped_column(Text)
    unit_id: Mapped[str] = mapped_column(Text)
    session_id: Mapped[UUID | None]
    content_version: Mapped[str] = mapped_column(Text)
    submission: Mapped[dict[str, Any]] = mapped_column(JSONB)
    rt_ms: Mapped[int] = mapped_column(Integer)
    hints_used: Mapped[int] = mapped_column(SmallInteger)
    plays_used: Mapped[int] = mapped_column(SmallInteger)
    verdict: Mapped[str] = mapped_column(Text)
    #: FSRS grade 1–4, null when the answer was not graded (free speech or writing)
    grade: Mapped[int | None] = mapped_column(SmallInteger)
    typo: Mapped[bool]
    local_verdict: Mapped[str | None] = mapped_column(Text)
    #: the device's clock and the server's disagreed by more than the allowance
    clock_adjusted: Mapped[bool] = mapped_column(server_default=text("false"))
    client_created_at: Mapped[datetime]
    ingested_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (
        CheckConstraint(_in("verdict", VERDICTS), name="verdict_valid"),
        CheckConstraint(
            f"local_verdict IS NULL OR {_in('local_verdict', VERDICTS)}", name="local_verdict_valid"
        ),
        CheckConstraint("grade IS NULL OR grade BETWEEN 1 AND 4", name="grade_range"),
        CheckConstraint("rt_ms BETWEEN 250 AND 120000", name="rt_clamped"),
        CheckConstraint("hints_used >= 0 AND plays_used >= 0", name="counts_non_negative"),
        {"postgresql_partition_by": "RANGE (ts)"},
    )


class ReviewLog(Base):
    __tablename__ = "review_log"

    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    ts: Mapped[datetime] = mapped_column(primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    attempt_id: Mapped[UUID]
    memory_item_id: Mapped[str] = mapped_column(Text)
    grade: Mapped[int] = mapped_column(SmallInteger)
    item_id: Mapped[str] = mapped_column(Text)
    type_id: Mapped[str] = mapped_column(Text)
    scheduler_version: Mapped[str] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint("grade BETWEEN 1 AND 4", name="grade_range"),
        Index(
            "ix_review_log_learner_id_memory_item_id_ts",
            "learner_id",
            "memory_item_id",
            "ts",
            postgresql_include=["grade", "item_id"],
        ),
        {"postgresql_partition_by": "RANGE (ts)"},
    )


class MemoryState(Base):
    __tablename__ = "memory_state"

    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    memory_item_id: Mapped[str] = mapped_column(Text, primary_key=True)
    stability: Mapped[float] = mapped_column(Float)
    difficulty: Mapped[float] = mapped_column(Float)
    due: Mapped[datetime]
    last_review: Mapped[datetime]
    #: the learner-local day of the last review (same-day rule, docs/08 §2.8)
    last_review_day: Mapped[date]
    #: reviews of this item on ``last_review_day`` (capped at 2 per day for scheduling)
    reviews_today: Mapped[int] = mapped_column(SmallInteger)
    reps: Mapped[int] = mapped_column(Integer)
    lapses: Mapped[int] = mapped_column(Integer)
    lapses_last_30_days: Mapped[int] = mapped_column(SmallInteger)
    state: Mapped[str] = mapped_column(Text)
    suspended: Mapped[bool] = mapped_column(server_default=text("false"))
    last_item_id: Mapped[str] = mapped_column(Text)
    last_type_id: Mapped[str] = mapped_column(Text)
    scheduler_version: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (
        CheckConstraint(_in("state", MEMORY_STATES), name="state_valid"),
        CheckConstraint("stability > 0", name="stability_positive"),
        CheckConstraint("difficulty BETWEEN 1 AND 10", name="difficulty_range"),
        Index(
            "ix_memory_state_learner_id_due",
            "learner_id",
            "due",
            postgresql_where=text("state NOT IN ('suspended', 'retired')"),
        ),
        {"postgresql_partition_by": "HASH (learner_id)"},
    )


class AnswerDispute(Base):
    __tablename__ = "answer_disputes"

    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    client_uuid: Mapped[UUID] = mapped_column(primary_key=True)
    review_client_uuid: Mapped[UUID]
    item_id: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default=text("'open'"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (
        CheckConstraint(_in("status", DISPUTE_STATUSES), name="status_valid"),
        Index("ix_answer_disputes_item_id", "item_id"),
    )
