"""The accessibility profile in settings; password reset tokens (2026-10-08).

Revision ID: 0009_access
Revises: 0008_media
Create Date: 2026-10-08
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_access"
down_revision: str | None = "0008_media"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "lep_app_rw"
UUID = postgresql.UUID(as_uuid=True)
TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column(
        "learner_settings",
        sa.Column("a11y_no_audio", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "learner_settings",
        sa.Column("a11y_no_vision", sa.Boolean(), server_default=sa.false(), nullable=False),
    )

    op.create_table(
        "password_reset_tokens",
        sa.Column("id", UUID, nullable=False),
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("expires_at", TZ, nullable=False),
        sa.Column("used_at", TZ, nullable=True),
        sa.CheckConstraint(
            "octet_length(token_hash) = 32",
            name=op.f("ck_password_reset_tokens_token_hash_sha256"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_password_reset_tokens_expires_after_creation"),
        ),
        sa.ForeignKeyConstraint(
            ["learner_id"],
            ["learners.id"],
            name=op.f("fk_password_reset_tokens_learner_id_learners"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_password_reset_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_password_reset_tokens_token_hash")),
    )
    op.create_index("ix_password_reset_tokens_learner_id", "password_reset_tokens", ["learner_id"])
    op.create_index("ix_password_reset_tokens_expires_at", "password_reset_tokens", ["expires_at"])
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO {APP_ROLE}")


def downgrade() -> None:
    op.drop_table("password_reset_tokens")
    op.drop_column("learner_settings", "a11y_no_vision")
    op.drop_column("learner_settings", "a11y_no_audio")
