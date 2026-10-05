"""Level exams, rubric scores, rater calibration, audits, appeals and level awards (Phase 7).

docs/12 §4–§6, docs/00 §7, docs/08 §9. A level award row keeps the whole evidence object it was
decided on, so a certificate can always be traced to the four conditions and their values.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


def _fk() -> ForeignKey:
    return ForeignKey("learners.id", ondelete="CASCADE")


class LevelExam(Base):
    """The receptive papers of a level exam; its answers arrive through the review sync."""

    __tablename__ = "level_exams"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    level: Mapped[str] = mapped_column(Text)
    #: paper → item ids
    papers: Mapped[dict[str, list[str]]] = mapped_column(JSONB)
    created_at: Mapped[datetime]
    completed_at: Mapped[datetime | None]
    #: paper → share right
    scores: Mapped[dict[str, float] | None] = mapped_column(JSONB)
    passed: Mapped[bool | None]

    __table_args__ = (
        CheckConstraint("level IN ('A1','A2','B1','B2','C1','C2')", name="level_valid"),
        Index("ix_level_exams_learner_id_level", "learner_id", "level"),
    )


class ProductionSubmission(Base):
    """A writing (or, once speech scoring exists, speaking) task for the production condition."""

    __tablename__ = "production_submissions"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    level: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    task_id: Mapped[str] = mapped_column(Text)
    prompt: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime]

    __table_args__ = (
        CheckConstraint("kind IN ('writing','speaking','mediation')", name="kind_valid"),
        CheckConstraint("status IN ('awaiting_rater','scored')", name="status_valid"),
    )


class RubricScore(Base):
    """One rater's score of one submission, with the evidence for every criterion."""

    __tablename__ = "rubric_scores"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    submission_id: Mapped[UUID]
    level: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    rater_kind: Mapped[str] = mapped_column(Text)
    rater_version: Mapped[str] = mapped_column(Text)
    prompt_version: Mapped[str | None] = mapped_column(Text)
    #: criterion → {"band": float, "evidence": [str, …]}
    criteria: Mapped[dict[str, Any]] = mapped_column(JSONB)
    overall: Mapped[float] = mapped_column(Float)
    #: usable for certification: a human, or a machine rater calibrated at κ ≥ 0.75
    certifying: Mapped[bool]
    borderline: Mapped[bool]
    created_at: Mapped[datetime]

    __table_args__ = (
        CheckConstraint("rater_kind IN ('automatic','llm','human')", name="rater_kind_valid"),
        CheckConstraint("overall BETWEEN 1 AND 6", name="overall_range"),
        # every score carries its evidence, and a machine score its prompt version
        CheckConstraint("criteria <> '{}'::jsonb", name="has_evidence"),
        CheckConstraint(
            "rater_kind = 'human' OR prompt_version IS NOT NULL", name="machine_prompt_version"
        ),
        Index("ix_rubric_scores_learner_id_level", "learner_id", "level"),
    )


class RaterCalibration(Base):
    """Quadratic weighted κ of a rater version against the human panel, per level and task."""

    __tablename__ = "rater_calibrations"

    rater_version: Mapped[str] = mapped_column(Text, primary_key=True)
    level: Mapped[str] = mapped_column(Text, primary_key=True)
    kind: Mapped[str] = mapped_column(Text, primary_key=True)
    kappa: Mapped[float] = mapped_column(Float)
    samples: Mapped[int] = mapped_column(Integer)
    measured_at: Mapped[datetime]


class HumanAudit(Base):
    """Work for a human rater: 10 % of certifying scores, every borderline one, every appeal."""

    __tablename__ = "human_audits"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    score_id: Mapped[UUID]
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime]

    __table_args__ = (
        CheckConstraint("reason IN ('sample','borderline','appeal')", name="reason_valid"),
        CheckConstraint("status IN ('queued','done')", name="status_valid"),
        UniqueConstraint("learner_id", "score_id", "reason"),
    )


class Appeal(Base):
    """Any certification-level score may be appealed once (docs/12 §6.2)."""

    __tablename__ = "appeals"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    score_id: Mapped[UUID]
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime]

    __table_args__ = (UniqueConstraint("learner_id", "score_id"),)


class LevelAward(Base):
    """Each evaluation of the four conditions, with the whole evidence object."""

    __tablename__ = "level_awards"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    level: Mapped[str] = mapped_column(Text)
    awarded: Mapped[bool]
    evidence: Mapped[dict[str, Any]] = mapped_column(JSONB)
    evaluated_at: Mapped[datetime]

    __table_args__ = (Index("ix_level_awards_learner_id_level", "learner_id", "level"),)


class RetentionAudit(Base):
    """The monthly surprise check: 20 known items, cold; predicted vs actual recall (docs/08 §9)."""

    __tablename__ = "retention_audits"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    item_ids: Mapped[list[str]] = mapped_column(ARRAY(Text))
    memory_item_ids: Mapped[list[str]] = mapped_column(ARRAY(Text))
    predicted: Mapped[float] = mapped_column(Float)
    actual: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime]
    completed_at: Mapped[datetime | None]
