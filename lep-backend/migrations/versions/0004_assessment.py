"""Checkpoints (test-out) and placement.

Revision ID: 0004_assessment
Revises: 0003_gamification
Create Date: 2026-10-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_assessment"
down_revision: str | None = "0003_gamification"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "lep_app_rw"


def _fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["learner_id"],
        ["learners.id"],
        name=op.f(f"fk_{table}_learner_id_learners"),
        ondelete="CASCADE",
    )


def upgrade() -> None:
    op.create_table(
        "checkpoints",
        sa.Column("learner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("unit_id", sa.Text(), nullable=False),
        sa.Column("item_ids", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("accuracy", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("learner_id", "id", name=op.f("pk_checkpoints")),
        _fk("checkpoints"),
    )
    op.create_table(
        "placements",
        sa.Column("learner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lo", sa.SmallInteger(), nullable=False),
        sa.Column("hi", sa.SmallInteger(), nullable=False),
        sa.Column("stage_level", sa.SmallInteger(), nullable=True),
        sa.Column("stage_items", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("history", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("result_level", sa.SmallInteger(), nullable=True),
        sa.PrimaryKeyConstraint("learner_id", "id", name=op.f("pk_placements")),
        _fk("placements"),
        sa.CheckConstraint(
            "lo BETWEEN 0 AND 10 AND hi BETWEEN -1 AND 9", name=op.f("ck_placements_bounds_range")
        ),
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON checkpoints, placements TO {APP_ROLE}")


def downgrade() -> None:
    op.drop_table("placements")
    op.drop_table("checkpoints")
