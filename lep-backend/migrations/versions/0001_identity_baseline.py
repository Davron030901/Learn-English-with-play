"""Identity baseline: learners, learner settings, auth sessions, refresh tokens.

Also creates what later migrations rely on:

* the ``citext`` extension (case-insensitive email uniqueness);
* ``lep_set_updated_at()``, the trigger function that maintains ``updated_at``;
* the ``lep_app_rw`` group role. The API's login role is a member of it and so can
  read and write rows but cannot create, alter or drop anything. Every migration grants
  its new tables to this role explicitly.

Revision ID: 0001_identity_baseline
Revises:
Create Date: 2026-09-25
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_identity_baseline"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "lep_app_rw"
TABLES = ("learners", "learner_settings", "auth_sessions", "refresh_tokens")
UPDATED_AT_TABLES = ("learners", "learner_settings")


def _timestamps() -> list[sa.Column[Any]]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                CREATE ROLE {APP_ROLE} NOLOGIN;
            END IF;
        END
        $$
        """)
    op.execute("""
        CREATE FUNCTION lep_set_updated_at() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            NEW.updated_at := now();
            RETURN NEW;
        END
        $$
        """)

    op.create_table(
        "learners",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("l1", sa.Text(), nullable=False),
        sa.Column("birth_year", sa.SmallInteger(), nullable=False),
        sa.Column("tz", sa.Text(), nullable=False),
        sa.Column(
            "daily_goal_min", sa.SmallInteger(), server_default=sa.text("10"), nullable=False
        ),
        sa.Column("status", sa.Text(), server_default=sa.text("'active'"), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_learners")),
        sa.UniqueConstraint("email", name=op.f("uq_learners_email")),
        sa.CheckConstraint(
            "length(email) BETWEEN 3 AND 254", name=op.f("ck_learners_email_length")
        ),
        sa.CheckConstraint(
            "l1 ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$'",
            name=op.f("ck_learners_l1_language_tag"),
        ),
        sa.CheckConstraint(
            "birth_year BETWEEN 1900 AND 2100", name=op.f("ck_learners_birth_year_range")
        ),
        sa.CheckConstraint("length(tz) BETWEEN 1 AND 64", name=op.f("ck_learners_tz_length")),
        sa.CheckConstraint(
            "daily_goal_min IN (5, 10, 20, 40)", name=op.f("ck_learners_daily_goal_choice")
        ),
        sa.CheckConstraint(
            "status IN ('active', 'suspended', 'deleted')", name=op.f("ck_learners_status_valid")
        ),
    )

    op.create_table(
        "learner_settings",
        sa.Column("learner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "desired_retention",
            sa.Numeric(3, 2),
            server_default=sa.text("0.90"),
            nullable=False,
        ),
        sa.Column(
            "rest_days",
            postgresql.ARRAY(sa.SmallInteger()),
            server_default=sa.text("'{}'::smallint[]"),
            nullable=False,
        ),
        sa.Column("leagues_opt_in", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("perfectionist_mode", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "data_collection_paused", sa.Boolean(), server_default=sa.false(), nullable=False
        ),
        sa.Column("spelling_variant", sa.Text(), server_default=sa.text("'us'"), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("learner_id", name=op.f("pk_learner_settings")),
        sa.ForeignKeyConstraint(
            ["learner_id"],
            ["learners.id"],
            name=op.f("fk_learner_settings_learner_id_learners"),
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "desired_retention IN (0.85, 0.90, 0.94)",
            name=op.f("ck_learner_settings_retention_preset"),
        ),
        sa.CheckConstraint(
            "rest_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[] AND cardinality(rest_days) <= 2",
            name=op.f("ck_learner_settings_rest_days_valid"),
        ),
        sa.CheckConstraint(
            "spelling_variant IN ('us', 'uk')",
            name=op.f("ck_learner_settings_spelling_variant_valid"),
        ),
    )

    op.create_table(
        "auth_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("learner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.Text(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_sessions")),
        sa.ForeignKeyConstraint(
            ["learner_id"],
            ["learners.id"],
            name=op.f("fk_auth_sessions_learner_id_learners"),
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "(revoked_at IS NULL) = (revoked_reason IS NULL)",
            name=op.f("ck_auth_sessions_revocation_complete"),
        ),
        sa.CheckConstraint(
            "revoked_reason IN ('logout', 'refresh_token_reuse', 'password_change', 'admin')",
            name=op.f("ck_auth_sessions_revoked_reason_valid"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at", name=op.f("ck_auth_sessions_expires_after_creation")
        ),
        sa.CheckConstraint(
            "length(user_agent) <= 256", name=op.f("ck_auth_sessions_user_agent_length")
        ),
    )
    op.create_index("ix_auth_sessions_learner_id", "auth_sessions", ["learner_id"])
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])
    op.create_index(
        "ix_auth_sessions_revoked_at",
        "auth_sessions",
        ["revoked_at"],
        postgresql_where=sa.text("revoked_at IS NOT NULL"),
    )

    op.create_table(
        "refresh_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replaced_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_refresh_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_refresh_tokens_token_hash")),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["auth_sessions.id"],
            name=op.f("fk_refresh_tokens_session_id_auth_sessions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["replaced_by"],
            ["refresh_tokens.id"],
            name=op.f("fk_refresh_tokens_replaced_by_refresh_tokens"),
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "octet_length(token_hash) = 32", name=op.f("ck_refresh_tokens_token_hash_sha256")
        ),
        sa.CheckConstraint(
            "expires_at > created_at", name=op.f("ck_refresh_tokens_expires_after_creation")
        ),
        sa.CheckConstraint(
            "replaced_by IS NULL OR used_at IS NOT NULL",
            name=op.f("ck_refresh_tokens_replacement_is_use"),
        ),
    )
    op.create_index("ix_refresh_tokens_session_id", "refresh_tokens", ["session_id"])
    op.create_index("ix_refresh_tokens_expires_at", "refresh_tokens", ["expires_at"])
    op.create_index(
        "ix_refresh_tokens_replaced_by",
        "refresh_tokens",
        ["replaced_by"],
        postgresql_where=sa.text("replaced_by IS NOT NULL"),
    )

    for table in UPDATED_AT_TABLES:
        op.execute(
            f"CREATE TRIGGER trg_{table}_updated_at BEFORE UPDATE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION lep_set_updated_at()"
        )

    op.execute(f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}")
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {', '.join(TABLES)} TO {APP_ROLE}")


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
    op.execute("DROP FUNCTION IF EXISTS lep_set_updated_at()")
    op.execute(f"REVOKE USAGE ON SCHEMA public FROM {APP_ROLE}")
    # The citext extension and the lep_app_rw role stay: the extension is database-wide
    # and the role cluster-wide, and other objects or databases may depend on them.
