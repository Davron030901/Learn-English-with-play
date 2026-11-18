"""The AI conversation partner: conversations, turns and the daily allowance.

Revision ID: 0005_ai_partner
Revises: 0004_assessment
Create Date: 2026-10-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_ai_partner"
down_revision: str | None = "0004_assessment"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "lep_app_rw"
UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB(astext_type=sa.Text())
TZ = sa.DateTime(timezone=True)


def _fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["learner_id"],
        ["learners.id"],
        name=op.f(f"fk_{table}_learner_id_learners"),
        ondelete="CASCADE",
    )


def upgrade() -> None:
    op.create_table(
        "ai_conversations",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("id", UUID, nullable=False),
        sa.Column("character_id", sa.Text(), nullable=False),
        sa.Column("unit_id", sa.Text(), nullable=False),
        sa.Column("cefr", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("subgoals", JSONB, nullable=False),
        sa.Column("met", JSONB, nullable=False),
        sa.Column("turns", sa.SmallInteger(), nullable=False),
        sa.Column("xp", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("prompt_version", sa.Text(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("ended_at", TZ, nullable=True),
        sa.Column("expires_at", TZ, nullable=False),
        sa.Column("summary", JSONB, nullable=True),
        sa.Column("client_uuid", UUID, nullable=True),
        sa.PrimaryKeyConstraint("learner_id", "id", name=op.f("pk_ai_conversations")),
        _fk("ai_conversations"),
        sa.CheckConstraint(
            "mode IN ('fluency', 'accuracy')", name=op.f("ck_ai_conversations_mode_valid")
        ),
        sa.CheckConstraint(
            "status IN ('open', 'ended')", name=op.f("ck_ai_conversations_status_valid")
        ),
        sa.CheckConstraint("turns >= 0", name=op.f("ck_ai_conversations_turns_non_negative")),
    )
    op.create_index("ix_ai_conversations_expires_at", "ai_conversations", ["expires_at"])
    op.create_index(
        "uq_ai_conversations_learner_id_client_uuid",
        "ai_conversations",
        ["learner_id", "client_uuid"],
        unique=True,
        postgresql_where=sa.text("client_uuid IS NOT NULL"),
    )
    op.create_table(
        "ai_turns",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("conversation_id", UUID, nullable=False),
        sa.Column("seq", sa.SmallInteger(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("recasts", JSONB, nullable=False),
        sa.Column("client_uuid", UUID, nullable=True),
        sa.Column("off_limits", sa.Boolean(), nullable=False),
        sa.Column("answering_until", TZ, nullable=True),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("expires_at", TZ, nullable=False),
        sa.PrimaryKeyConstraint("learner_id", "conversation_id", "seq", name=op.f("pk_ai_turns")),
        _fk("ai_turns"),
        sa.ForeignKeyConstraint(
            ["learner_id", "conversation_id"],
            ["ai_conversations.learner_id", "ai_conversations.id"],
            name=op.f("fk_ai_turns_learner_id_conversation_id_ai_conversations"),
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("role IN ('learner', 'character')", name=op.f("ck_ai_turns_role_valid")),
    )
    op.create_index(
        "uq_ai_turns_learner_id_conversation_id_client_uuid",
        "ai_turns",
        ["learner_id", "conversation_id", "client_uuid"],
        unique=True,
        postgresql_where=sa.text("client_uuid IS NOT NULL"),
    )
    op.create_index("ix_ai_turns_expires_at", "ai_turns", ["expires_at"])
    op.create_table(
        "ai_usage_daily",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("conversations", sa.Integer(), nullable=False),
        sa.Column("turns", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.BigInteger(), nullable=False),
        sa.Column("output_tokens", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("learner_id", "day", name=op.f("pk_ai_usage_daily")),
        _fk("ai_usage_daily"),
    )
    op.drop_constraint(op.f("ck_xp_events_source_valid"), "xp_events", type_="check")
    op.create_check_constraint(
        op.f("ck_xp_events_source_valid"),
        "xp_events",
        "source IN ('answer', 'reading', 'listening', 'writing', 'conversation')",
    )
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON ai_conversations, ai_turns, ai_usage_daily "
        f"TO {APP_ROLE}"
    )


def downgrade() -> None:
    op.execute("DELETE FROM xp_events WHERE source = 'conversation'")
    op.drop_constraint(op.f("ck_xp_events_source_valid"), "xp_events", type_="check")
    op.create_check_constraint(
        op.f("ck_xp_events_source_valid"),
        "xp_events",
        "source IN ('answer', 'reading', 'listening', 'writing')",
    )
    op.drop_table("ai_usage_daily")
    op.drop_table("ai_turns")
    op.drop_table("ai_conversations")
