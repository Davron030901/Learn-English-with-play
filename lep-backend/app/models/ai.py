"""The AI conversation partner's records (docs/16 E21, docs/10 §8.9).

Transcripts are learner data: kept ``LEP_AI_RETENTION_DAYS`` (30) days, then purged by the
worker; exportable (``GET``) and deletable (``DELETE``) by the learner at any time; erased with
the account (``ON DELETE CASCADE``); never used for training.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    Text,
)
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


def _fk() -> ForeignKey:
    return ForeignKey("learners.id", ondelete="CASCADE")


class AiConversation(Base):
    __tablename__ = "ai_conversations"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    character_id: Mapped[str] = mapped_column(Text)
    unit_id: Mapped[str] = mapped_column(Text)
    cefr: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(Text)
    #: [{"id": "g1", "text": "Order food and drink"}, …]
    subgoals: Mapped[list[dict[str, str]]] = mapped_column(JSONB)
    met: Mapped[list[str]] = mapped_column(JSONB)
    #: learner turns taken so far
    turns: Mapped[int] = mapped_column(SmallInteger)
    xp: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text)
    prompt_version: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime]
    ended_at: Mapped[datetime | None]
    expires_at: Mapped[datetime]
    summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: the app's id for this start: a retried start returns the same conversation, charged once
    client_uuid: Mapped[UUID | None]

    __table_args__ = (
        CheckConstraint("mode IN ('fluency', 'accuracy')", name="mode_valid"),
        CheckConstraint("status IN ('open', 'ended')", name="status_valid"),
        CheckConstraint("turns >= 0", name="turns_non_negative"),
        Index("ix_ai_conversations_expires_at", "expires_at"),
        Index(
            "uq_ai_conversations_learner_id_client_uuid",
            "learner_id",
            "client_uuid",
            unique=True,
            postgresql_where=sql_text("client_uuid IS NOT NULL"),
        ),
    )


class AiTurn(Base):
    """One message: the character's opening line is seq 0; learner turn k is 2k-1, its reply 2k."""

    __tablename__ = "ai_turns"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    conversation_id: Mapped[UUID] = mapped_column(primary_key=True)
    seq: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    role: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    #: [{"original": …, "corrected": …}]
    recasts: Mapped[list[dict[str, str]]] = mapped_column(JSONB)
    client_uuid: Mapped[UUID | None]
    #: a character turn that answered an off-limits message with the fixed safe line
    off_limits: Mapped[bool]
    #: a learner turn whose reply is being written: no other request asks the model for it
    #: (or replaces it) until then
    answering_until: Mapped[datetime | None]
    created_at: Mapped[datetime]
    expires_at: Mapped[datetime]

    __table_args__ = (
        CheckConstraint("role IN ('learner', 'character')", name="role_valid"),
        ForeignKeyConstraint(
            ["learner_id", "conversation_id"],
            ["ai_conversations.learner_id", "ai_conversations.id"],
            ondelete="CASCADE",
        ),
        Index(
            "uq_ai_turns_learner_id_conversation_id_client_uuid",
            "learner_id",
            "conversation_id",
            "client_uuid",
            unique=True,
            postgresql_where=sql_text("client_uuid IS NOT NULL"),
        ),
        Index("ix_ai_turns_expires_at", "expires_at"),
    )


class AiUsageDaily(Base):
    """The published, uniform allowance (docs/16 E21): conversations and tokens per local day."""

    __tablename__ = "ai_usage_daily"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    day: Mapped[date] = mapped_column(primary_key=True)
    conversations: Mapped[int] = mapped_column(Integer)
    turns: Mapped[int] = mapped_column(Integer)
    input_tokens: Mapped[int] = mapped_column(BigInteger)
    output_tokens: Mapped[int] = mapped_column(BigInteger)
