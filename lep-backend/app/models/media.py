"""Audio assets, voice recordings and their tombstones (backend brief §10; docs/11 §10).

Voice recordings are **Sensitive**: kept ``LEP_VOICE_RETENTION_DAYS`` (≤ 30) days or less, never
used for training without a separate opt-in, deleted for real — the row and its audio — with a
tombstone that records only that a recording existed and when and why it went.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, LargeBinary, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class MediaAsset(Base):
    """One audio file the content refers to: missing → tts_draft → recorded → qc_passed."""

    __tablename__ = "media_assets"

    path: Mapped[str] = mapped_column(Text, primary_key=True)
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    #: version of the voice or the recording session that made it
    made_by: Mapped[str | None] = mapped_column(Text)
    sha256: Mapped[str | None] = mapped_column(Text)
    bytes: Mapped[int | None] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    qc: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    updated_at: Mapped[datetime]

    __table_args__ = (
        CheckConstraint(
            "status IN ('missing','tts_draft','recorded','qc_passed')", name="status_valid"
        ),
        Index("ix_media_assets_status", "status"),
    )


class Recording(Base):
    """A learner's voice: a pronunciation attempt or a speaking task, scored asynchronously."""

    __tablename__ = "recordings"

    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    purpose: Mapped[str] = mapped_column(Text)
    level: Mapped[str] = mapped_column(Text)
    #: what the learner was asked to say (None for free speech)
    expected: Mapped[str | None] = mapped_column(Text)
    task_id: Mapped[str | None] = mapped_column(Text)
    item_id: Mapped[str | None] = mapped_column(Text)
    audio: Mapped[bytes] = mapped_column(LargeBinary)
    mime: Mapped[str] = mapped_column(Text)
    seconds: Mapped[int] = mapped_column(Integer)
    #: the learner-local day the seconds were charged to (refunded there if scoring fails)
    charged_day: Mapped[date]
    status: Mapped[str] = mapped_column(Text)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime]
    expires_at: Mapped[datetime]

    __table_args__ = (
        CheckConstraint("purpose IN ('pronunciation','speaking_task')", name="purpose_valid"),
        CheckConstraint("status IN ('queued','scored','failed')", name="status_valid"),
        Index("ix_recordings_expires_at", "expires_at"),
    )


class RecordingTombstone(Base):
    """That a recording existed and why it was deleted — nothing of its content."""

    __tablename__ = "recording_tombstones"

    learner_id: Mapped[UUID] = mapped_column(primary_key=True)
    recording_id: Mapped[UUID] = mapped_column(primary_key=True)
    reason: Mapped[str] = mapped_column(Text)
    deleted_at: Mapped[datetime]

    __table_args__ = (
        CheckConstraint("reason IN ('expired','learner','account')", name="reason_valid"),
    )


class MediaUsageDaily(Base):
    """The uniform daily ceilings: synthesised characters and seconds of speech scored."""

    __tablename__ = "media_usage_daily"

    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(primary_key=True)
    tts_chars: Mapped[int] = mapped_column(Integer)
    speech_seconds: Mapped[int] = mapped_column(Integer)
