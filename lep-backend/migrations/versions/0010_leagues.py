"""Opt-in weekly leagues (docs/16 E23): display names, tiers, leagues and their members.

Revision ID: 0010_leagues
Revises: 0009_access
Create Date: 2026-10-10
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_leagues"
down_revision: str | None = "0009_access"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "lep_app_rw"
UUID = postgresql.UUID(as_uuid=True)
TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column("learners", sa.Column("display_name", sa.Text(), nullable=True))
    op.create_check_constraint(
        op.f("ck_learners_display_name_length"),
        "learners",
        "display_name IS NULL OR char_length(display_name) BETWEEN 2 AND 24",
    )
    op.add_column(
        "learner_settings",
        sa.Column("league_tier", sa.SmallInteger(), server_default=sa.text("1"), nullable=False),
    )
    op.add_column("learner_settings", sa.Column("leagues_left_at", TZ, nullable=True))
    op.create_check_constraint(
        op.f("ck_learner_settings_league_tier_range"),
        "learner_settings",
        "league_tier BETWEEN 1 AND 10",
    )
    op.create_index("ix_xp_events_learner_id_ts", "xp_events", ["learner_id", "ts"])

    op.create_table(
        "leagues",
        sa.Column("id", UUID, nullable=False),
        sa.Column("week_starts_at", TZ, nullable=False),
        sa.Column("tier", sa.SmallInteger(), nullable=False),
        sa.Column("seed_xp", sa.Integer(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("settled_at", TZ, nullable=True),
        sa.CheckConstraint("tier BETWEEN 1 AND 10", name=op.f("ck_leagues_tier_range")),
        sa.CheckConstraint("seed_xp >= 0", name=op.f("ck_leagues_seed_non_negative")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_leagues")),
    )
    op.create_index("ix_leagues_week_starts_at_tier", "leagues", ["week_starts_at", "tier"])
    op.create_index(
        "ix_leagues_unsettled",
        "leagues",
        ["week_starts_at"],
        postgresql_where=sa.text("settled_at IS NULL"),
    )

    op.create_table(
        "league_members",
        sa.Column("league_id", UUID, nullable=False),
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("week_starts_at", TZ, nullable=False),
        sa.Column("joined_at", TZ, nullable=False),
        sa.Column("final_xp_centi", sa.Integer(), nullable=True),
        sa.Column("final_rank", sa.SmallInteger(), nullable=True),
        sa.Column("moved", sa.SmallInteger(), nullable=True),
        sa.Column("tier_after", sa.SmallInteger(), nullable=True),
        sa.Column("tier_applied", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("result_seen", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint("moved IN (-1, 0, 1)", name=op.f("ck_league_members_moved_valid")),
        sa.CheckConstraint(
            "tier_after BETWEEN 1 AND 10", name=op.f("ck_league_members_tier_after_range")
        ),
        sa.CheckConstraint(
            "(final_rank IS NULL) = (moved IS NULL) AND (moved IS NULL) = (tier_after IS NULL)",
            name=op.f("ck_league_members_result_complete"),
        ),
        sa.ForeignKeyConstraint(
            ["league_id"],
            ["leagues.id"],
            name=op.f("fk_league_members_league_id_leagues"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["learner_id"],
            ["learners.id"],
            name=op.f("fk_league_members_learner_id_learners"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("league_id", "learner_id", name=op.f("pk_league_members")),
        sa.UniqueConstraint(
            "learner_id",
            "week_starts_at",
            name=op.f("uq_league_members_learner_id_week_starts_at"),
        ),
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON leagues, league_members TO {APP_ROLE}")


def downgrade() -> None:
    op.drop_table("league_members")
    op.drop_table("leagues")
    op.drop_index("ix_xp_events_learner_id_ts", table_name="xp_events")
    op.drop_constraint(
        op.f("ck_learner_settings_league_tier_range"), "learner_settings", type_="check"
    )
    op.drop_column("learner_settings", "leagues_left_at")
    op.drop_column("learner_settings", "league_tier")
    op.drop_constraint(op.f("ck_learners_display_name_length"), "learners", type_="check")
    op.drop_column("learners", "display_name")
