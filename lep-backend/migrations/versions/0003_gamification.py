"""Progress and gamification: days, XP, streaks, gems, node/unit progress, badges, cosmetics.

Revision ID: 0003_gamification
Revises: 0002_review_pipeline
Create Date: 2026-10-04
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_gamification"
down_revision: str | None = "0002_review_pipeline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "lep_app_rw"
TABLES = (
    "learner_days",
    "xp_events",
    "streaks",
    "gem_ledger",
    "node_progress",
    "unit_progress",
    "badges",
    "cosmetics",
)
GEM_REASONS = "'daily_goal', 'quest', 'unit_complete', 'checkpoint', 'weekly_immersion', 'purchase'"


def _uuid(name: str, nullable: bool = False) -> sa.Column[Any]:
    return sa.Column(name, postgresql.UUID(as_uuid=True), nullable=nullable)


def _fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["learner_id"],
        ["learners.id"],
        name=op.f(f"fk_{table}_learner_id_learners"),
        ondelete="CASCADE",
    )


def _zero(name: str, type_: sa.types.TypeEngine[int]) -> sa.Column[int]:
    return sa.Column(name, type_, server_default=sa.text("0"), nullable=False)


def upgrade() -> None:
    op.create_table(
        "learner_days",
        _uuid("learner_id"),
        sa.Column("day", sa.Date(), nullable=False),
        _zero("answers", sa.Integer()),
        _zero("correct", sa.Integer()),
        _zero("active_ms", sa.BigInteger()),
        _zero("xp_centi", sa.Integer()),
        _zero("run_now", sa.SmallInteger()),
        _zero("best_run", sa.SmallInteger()),
        _zero("speaking", sa.Integer()),
        _zero("listening", sa.Integer()),
        _zero("reviewed_due", sa.Integer()),
        _zero("nodes_completed", sa.Integer()),
        sa.Column("goal_met_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("learner_id", "day", name=op.f("pk_learner_days")),
        _fk("learner_days"),
        sa.CheckConstraint(
            "answers >= 0 AND correct >= 0 AND active_ms >= 0 AND xp_centi >= 0",
            name=op.f("ck_learner_days_non_negative"),
        ),
    )

    op.create_table(
        "xp_events",
        _uuid("learner_id"),
        _uuid("id"),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("xp_centi", sa.Integer(), nullable=False),
        _uuid("attempt_id", nullable=True),
        _uuid("session_id", nullable=True),
        sa.Column("regrind", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.PrimaryKeyConstraint("learner_id", "id", name=op.f("pk_xp_events")),
        _fk("xp_events"),
        sa.CheckConstraint(
            "source IN ('answer', 'reading', 'listening', 'writing')",
            name=op.f("ck_xp_events_source_valid"),
        ),
        sa.CheckConstraint("xp_centi >= 0", name=op.f("ck_xp_events_xp_non_negative")),
    )
    op.create_index("ix_xp_events_learner_id_session_id", "xp_events", ["learner_id", "session_id"])

    op.create_table(
        "streaks",
        _uuid("learner_id"),
        _zero("current", sa.Integer()),
        _zero("longest", sa.Integer()),
        sa.Column("last_counted", sa.Date(), nullable=True),
        sa.Column("settled_through", sa.Date(), nullable=True),
        sa.Column("freezes", sa.SmallInteger(), server_default=sa.text("2"), nullable=False),
        sa.Column("freeze_clock", sa.Date(), nullable=True),
        sa.Column("paused_from", sa.Date(), nullable=True),
        sa.Column("paused_until", sa.Date(), nullable=True),
        sa.Column("broken_on", sa.Date(), nullable=True),
        _zero("broken_length", sa.Integer()),
        sa.Column("repaired_month", sa.Text(), nullable=True),
        sa.Column("unseen_reset_from", sa.Integer(), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("learner_id", name=op.f("pk_streaks")),
        _fk("streaks"),
        sa.CheckConstraint("freezes BETWEEN 0 AND 2", name=op.f("ck_streaks_freezes_range")),
        sa.CheckConstraint(
            "current >= 0 AND longest >= current", name=op.f("ck_streaks_lengths_valid")
        ),
    )
    op.execute(
        "CREATE TRIGGER streaks_set_updated_at BEFORE UPDATE ON streaks "
        "FOR EACH ROW EXECUTE FUNCTION lep_set_updated_at()"
    )

    op.create_table(
        "gem_ledger",
        _uuid("learner_id"),
        _uuid("id"),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("ref", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("learner_id", "id", name=op.f("pk_gem_ledger")),
        _fk("gem_ledger"),
        sa.UniqueConstraint(
            "learner_id", "reason", "ref", name="uq_gem_ledger_learner_id_reason_ref"
        ),
        sa.CheckConstraint(f"reason IN ({GEM_REASONS})", name=op.f("ck_gem_ledger_reason_valid")),
        sa.CheckConstraint(
            "(reason = 'purchase') = (amount < 0)", name=op.f("ck_gem_ledger_sign_matches_reason")
        ),
    )

    op.create_table(
        "node_progress",
        _uuid("learner_id"),
        sa.Column("node_id", sa.Text(), nullable=False),
        sa.Column("tier", sa.SmallInteger(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accuracy", sa.Float(), nullable=True),
        _uuid("session_id", nullable=True),
        sa.Column("tested_out", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.PrimaryKeyConstraint("learner_id", "node_id", "tier", name=op.f("pk_node_progress")),
        _fk("node_progress"),
        sa.CheckConstraint("tier BETWEEN 1 AND 3", name=op.f("ck_node_progress_tier_range")),
    )

    op.create_table(
        "unit_progress",
        _uuid("learner_id"),
        sa.Column("unit_id", sa.Text(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("learner_id", "unit_id", name=op.f("pk_unit_progress")),
        _fk("unit_progress"),
    )

    op.create_table(
        "badges",
        _uuid("learner_id"),
        sa.Column("badge_id", sa.Text(), nullable=False),
        sa.Column("unit_id", sa.Text(), nullable=False),
        sa.Column("awarded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("seen", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.PrimaryKeyConstraint("learner_id", "badge_id", name=op.f("pk_badges")),
        _fk("badges"),
    )

    op.create_table(
        "cosmetics",
        _uuid("learner_id"),
        sa.Column("item_id", sa.Text(), nullable=False),
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("equipped", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.PrimaryKeyConstraint("learner_id", "item_id", name=op.f("pk_cosmetics")),
        _fk("cosmetics"),
    )

    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {', '.join(TABLES)} TO {APP_ROLE}")


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
