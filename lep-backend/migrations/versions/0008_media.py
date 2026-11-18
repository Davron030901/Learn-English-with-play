"""Audio assets, voice recordings, tombstones, media ceilings, voice consent (Phase 8).

Revision ID: 0008_media
Revises: 0007_certification
Create Date: 2026-10-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_media"
down_revision: str | None = "0007_certification"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "lep_app_rw"
UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB(astext_type=sa.Text())
TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "media_assets",
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("made_by", sa.Text(), nullable=True),
        sa.Column("sha256", sa.Text(), nullable=True),
        sa.Column("bytes", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("qc", JSONB, nullable=True),
        sa.Column("updated_at", TZ, nullable=False),
        sa.CheckConstraint(
            "status IN ('missing','tts_draft','recorded','qc_passed')",
            name=op.f("ck_media_assets_status_valid"),
        ),
        sa.PrimaryKeyConstraint("path", name=op.f("pk_media_assets")),
    )
    op.create_index("ix_media_assets_status", "media_assets", ["status"])

    op.create_table(
        "recordings",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("id", UUID, nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("level", sa.Text(), nullable=False),
        sa.Column("expected", sa.Text(), nullable=True),
        sa.Column("task_id", sa.Text(), nullable=True),
        sa.Column("item_id", sa.Text(), nullable=True),
        sa.Column("audio", sa.LargeBinary(), nullable=False),
        sa.Column("mime", sa.Text(), nullable=False),
        sa.Column("seconds", sa.Integer(), nullable=False),
        sa.Column("charged_day", sa.Date(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("result", JSONB, nullable=True),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("expires_at", TZ, nullable=False),
        sa.CheckConstraint(
            "purpose IN ('pronunciation','speaking_task')",
            name=op.f("ck_recordings_purpose_valid"),
        ),
        sa.CheckConstraint(
            "status IN ('queued','scored','failed')", name=op.f("ck_recordings_status_valid")
        ),
        sa.ForeignKeyConstraint(
            ["learner_id"],
            ["learners.id"],
            name=op.f("fk_recordings_learner_id_learners"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("learner_id", "id", name=op.f("pk_recordings")),
    )
    op.create_index("ix_recordings_expires_at", "recordings", ["expires_at"])

    op.create_table(
        "recording_tombstones",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("recording_id", UUID, nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("deleted_at", TZ, nullable=False),
        sa.CheckConstraint(
            "reason IN ('expired','learner','account')",
            name=op.f("ck_recording_tombstones_reason_valid"),
        ),
        sa.PrimaryKeyConstraint("learner_id", "recording_id", name=op.f("pk_recording_tombstones")),
    )

    op.create_table(
        "media_usage_daily",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("tts_chars", sa.Integer(), nullable=False),
        sa.Column("speech_seconds", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["learner_id"],
            ["learners.id"],
            name=op.f("fk_media_usage_daily_learner_id_learners"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("learner_id", "day", name=op.f("pk_media_usage_daily")),
    )

    op.add_column(
        "learner_settings",
        sa.Column("voice_consent", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "learner_settings",
        sa.Column("training_opt_in", sa.Boolean(), server_default=sa.false(), nullable=False),
    )

    # every rubric score carries its evidence, and a machine score its prompt version
    op.create_check_constraint(
        op.f("ck_rubric_scores_has_evidence"), "rubric_scores", "criteria <> '{}'::jsonb"
    )
    op.create_check_constraint(
        op.f("ck_rubric_scores_machine_prompt_version"),
        "rubric_scores",
        "rater_kind = 'human' OR prompt_version IS NOT NULL",
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON media_assets TO {APP_ROLE}")
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON recordings, recording_tombstones, "
        f"media_usage_daily TO {APP_ROLE}"
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_rubric_scores_machine_prompt_version"), "rubric_scores", type_="check"
    )
    op.drop_constraint(op.f("ck_rubric_scores_has_evidence"), "rubric_scores", type_="check")
    op.drop_column("learner_settings", "training_opt_in")
    op.drop_column("learner_settings", "voice_consent")
    op.drop_table("media_usage_daily")
    op.drop_table("recording_tombstones")
    op.drop_table("recordings")
    op.drop_table("media_assets")
