"""Composed learning sessions (docs/08 §5).

Revision ID: 0006_sessions
Revises: 0005_ai_partner
Create Date: 2026-10-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_sessions"
down_revision: str | None = "0005_ai_partner"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "lep_app_rw"
UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB(astext_type=sa.Text())
TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "learner_sessions",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("id", UUID, nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("minutes", sa.SmallInteger(), nullable=False),
        sa.Column("node_id", sa.Text(), nullable=True),
        sa.Column("tier", sa.SmallInteger(), nullable=True),
        sa.Column("plan", JSONB, nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("completed_at", TZ, nullable=True),
        sa.CheckConstraint(
            "kind IN ('practice', 'node')", name=op.f("ck_learner_sessions_kind_valid")
        ),
        sa.CheckConstraint(
            "status IN ('open', 'completed')", name=op.f("ck_learner_sessions_status_valid")
        ),
        sa.CheckConstraint(
            "minutes BETWEEN 1 AND 60", name=op.f("ck_learner_sessions_minutes_range")
        ),
        sa.CheckConstraint(
            "tier IS NULL OR tier BETWEEN 1 AND 3", name=op.f("ck_learner_sessions_tier_range")
        ),
        sa.ForeignKeyConstraint(
            ["learner_id"],
            ["learners.id"],
            name=op.f("fk_learner_sessions_learner_id_learners"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("learner_id", "id", name=op.f("pk_learner_sessions")),
    )
    op.create_index(
        "ix_learner_sessions_learner_id_created_at",
        "learner_sessions",
        ["learner_id", "created_at"],
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON learner_sessions TO {APP_ROLE}")


def downgrade() -> None:
    op.drop_table("learner_sessions")
