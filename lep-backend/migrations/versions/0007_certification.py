"""Level exams, rubric scores, rater calibration, audits, appeals, level awards (Phase 7).

Revision ID: 0007_certification
Revises: 0006_sessions
Create Date: 2026-10-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_certification"
down_revision: str | None = "0006_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "lep_app_rw"
UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB(astext_type=sa.Text())
TZ = sa.DateTime(timezone=True)
TEXTS = postgresql.ARRAY(sa.Text())


def _fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["learner_id"],
        ["learners.id"],
        name=op.f(f"fk_{table}_learner_id_learners"),
        ondelete="CASCADE",
    )


def _pk(table: str) -> sa.PrimaryKeyConstraint:
    return sa.PrimaryKeyConstraint("learner_id", "id", name=op.f(f"pk_{table}"))


def upgrade() -> None:
    op.create_table(
        "level_exams",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("id", UUID, nullable=False),
        sa.Column("level", sa.Text(), nullable=False),
        sa.Column("papers", JSONB, nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("ends_at", TZ, nullable=False),
        sa.Column("reused", sa.Boolean(), nullable=False),
        sa.Column("completed_at", TZ, nullable=True),
        sa.Column("scores", JSONB, nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.CheckConstraint(
            "level IN ('A1','A2','B1','B2','C1','C2')", name=op.f("ck_level_exams_level_valid")
        ),
        _fk("level_exams"),
        _pk("level_exams"),
    )
    op.create_index("ix_level_exams_learner_id_level", "level_exams", ["learner_id", "level"])

    op.create_table(
        "production_submissions",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("id", UUID, nullable=False),
        sa.Column("level", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("task_id", sa.Text(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.CheckConstraint(
            "kind IN ('writing','speaking','mediation')",
            name=op.f("ck_production_submissions_kind_valid"),
        ),
        sa.CheckConstraint(
            "status IN ('awaiting_rater','scored')",
            name=op.f("ck_production_submissions_status_valid"),
        ),
        _fk("production_submissions"),
        _pk("production_submissions"),
    )

    op.create_table(
        "rubric_scores",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("id", UUID, nullable=False),
        sa.Column("submission_id", UUID, nullable=False),
        sa.Column("level", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("rater_kind", sa.Text(), nullable=False),
        sa.Column("rater_version", sa.Text(), nullable=False),
        sa.Column("prompt_version", sa.Text(), nullable=True),
        sa.Column("criteria", JSONB, nullable=False),
        sa.Column("overall", sa.Float(), nullable=False),
        sa.Column("certifying", sa.Boolean(), nullable=False),
        sa.Column("borderline", sa.Boolean(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.CheckConstraint(
            "rater_kind IN ('automatic','llm','human')",
            name=op.f("ck_rubric_scores_rater_kind_valid"),
        ),
        sa.CheckConstraint("overall BETWEEN 1 AND 6", name=op.f("ck_rubric_scores_overall_range")),
        _fk("rubric_scores"),
        _pk("rubric_scores"),
    )
    op.create_index("ix_rubric_scores_learner_id_level", "rubric_scores", ["learner_id", "level"])

    op.create_table(
        "rater_calibrations",
        sa.Column("rater_version", sa.Text(), nullable=False),
        sa.Column("level", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("kappa", sa.Float(), nullable=False),
        sa.Column("samples", sa.Integer(), nullable=False),
        sa.Column("measured_at", TZ, nullable=False),
        sa.PrimaryKeyConstraint(
            "rater_version", "level", "kind", name=op.f("pk_rater_calibrations")
        ),
    )

    op.create_table(
        "human_audits",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("id", UUID, nullable=False),
        sa.Column("score_id", UUID, nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.CheckConstraint(
            "reason IN ('sample','borderline','appeal')", name=op.f("ck_human_audits_reason_valid")
        ),
        sa.CheckConstraint(
            "status IN ('queued','done')", name=op.f("ck_human_audits_status_valid")
        ),
        sa.UniqueConstraint(
            "learner_id",
            "score_id",
            "reason",
            name=op.f("uq_human_audits_learner_id_score_id_reason"),
        ),
        _fk("human_audits"),
        _pk("human_audits"),
    )

    op.create_table(
        "appeals",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("id", UUID, nullable=False),
        sa.Column("score_id", UUID, nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.UniqueConstraint("learner_id", "score_id", name=op.f("uq_appeals_learner_id_score_id")),
        _fk("appeals"),
        _pk("appeals"),
    )

    op.create_table(
        "level_awards",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("id", UUID, nullable=False),
        sa.Column("level", sa.Text(), nullable=False),
        sa.Column("awarded", sa.Boolean(), nullable=False),
        sa.Column("evidence", JSONB, nullable=False),
        sa.Column("evaluated_at", TZ, nullable=False),
        _fk("level_awards"),
        _pk("level_awards"),
    )
    op.create_index("ix_level_awards_learner_id_level", "level_awards", ["learner_id", "level"])

    op.create_table(
        "retention_audits",
        sa.Column("learner_id", UUID, nullable=False),
        sa.Column("id", UUID, nullable=False),
        sa.Column("item_ids", TEXTS, nullable=False),
        sa.Column("memory_item_ids", TEXTS, nullable=False),
        sa.Column("predicted", sa.Float(), nullable=False),
        sa.Column("actual", sa.Float(), nullable=True),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("completed_at", TZ, nullable=True),
        _fk("retention_audits"),
        _pk("retention_audits"),
    )

    op.execute(
        "GRANT SELECT, INSERT, UPDATE ON level_exams, production_submissions, rubric_scores, "
        f"human_audits, appeals, level_awards, retention_audits TO {APP_ROLE}"
    )
    # calibrations are written by the rating team's tooling, not by the API: read only
    op.execute(f"GRANT SELECT ON rater_calibrations TO {APP_ROLE}")


def downgrade() -> None:
    for table in (
        "retention_audits",
        "level_awards",
        "appeals",
        "human_audits",
        "rater_calibrations",
        "rubric_scores",
        "production_submissions",
        "level_exams",
    ):
        op.drop_table(table)
