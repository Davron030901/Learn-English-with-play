"""Review pipeline: ingest keys, attempts, review log, memory state, disputes (brief Phase 4).

* ``review_attempts`` and ``review_log`` are range-partitioned by month on ``ts``. This
  migration creates the months 2026-01 … 2027-12 and a DEFAULT partition. Partitions are DDL,
  which the API and worker roles may not run (least privilege), so the next year's months are
  added by a migration; ``/ready`` and the partition check warn three months before they run
  out. A row in a DEFAULT partition means a client clock far outside the expected range.
* ``memory_state`` is hash-partitioned by learner into 64.
* Append-only is enforced here: ``lep_append_only()`` raises on UPDATE, DELETE and TRUNCATE
  unless the transaction set ``lep.erasure = 'on'`` (the account-erasure path). The API role is
  granted INSERT and SELECT only on the two log tables.

Revision ID: 0002_review_pipeline
Revises: 0001_identity_baseline
Create Date: 2026-10-03
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.models.partitions import MEMORY_STATE_PARTITIONS, month_partition, months_from

revision: str = "0002_review_pipeline"
down_revision: str | None = "0001_identity_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "lep_app_rw"
FIRST_MONTH = date(2026, 1, 1)
MONTHS = 24


def _learner_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["learner_id"],
        ["learners.id"],
        name=op.f(f"fk_{table}_learner_id_learners"),
        ondelete="CASCADE",
    )


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION lep_append_only() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF current_setting('lep.erasure', true) = 'on' THEN
                IF TG_OP = 'TRUNCATE' THEN
                    RETURN NULL;
                END IF;
                RETURN OLD;
            END IF;
            RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
                USING ERRCODE = 'insufficient_privilege';
        END
        $$
        """)

    op.create_table(
        "review_ingest_keys",
        sa.Column("learner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_uuid", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("attempt_ts", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("verdict", sa.Text(), nullable=True),
        sa.Column("grade", sa.SmallInteger(), nullable=True),
        sa.Column(
            "ingested_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("learner_id", "client_uuid", name=op.f("pk_review_ingest_keys")),
        _learner_fk("review_ingest_keys"),
        sa.CheckConstraint(
            "kind IN ('review', 'dispute')", name=op.f("ck_review_ingest_keys_kind_valid")
        ),
        sa.CheckConstraint(
            "verdict IS NULL OR verdict IN ('correct', 'incorrect', 'ungraded')",
            name=op.f("ck_review_ingest_keys_verdict_valid"),
        ),
        sa.CheckConstraint(
            "grade IS NULL OR grade BETWEEN 1 AND 4", name=op.f("ck_review_ingest_keys_grade_range")
        ),
    )

    op.create_table(
        "review_attempts",
        sa.Column("learner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_uuid", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_id", sa.Text(), nullable=False),
        sa.Column("type_id", sa.Text(), nullable=False),
        sa.Column("unit_id", sa.Text(), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("content_version", sa.Text(), nullable=False),
        sa.Column("submission", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("rt_ms", sa.Integer(), nullable=False),
        sa.Column("hints_used", sa.SmallInteger(), nullable=False),
        sa.Column("plays_used", sa.SmallInteger(), nullable=False),
        sa.Column("verdict", sa.Text(), nullable=False),
        sa.Column("grade", sa.SmallInteger(), nullable=True),
        sa.Column("typo", sa.Boolean(), nullable=False),
        sa.Column("local_verdict", sa.Text(), nullable=True),
        sa.Column("clock_adjusted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("client_created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "ingested_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("learner_id", "ts", "id", name=op.f("pk_review_attempts")),
        _learner_fk("review_attempts"),
        sa.CheckConstraint(
            "verdict IN ('correct', 'incorrect', 'ungraded')",
            name=op.f("ck_review_attempts_verdict_valid"),
        ),
        sa.CheckConstraint(
            "local_verdict IS NULL OR local_verdict IN ('correct', 'incorrect', 'ungraded')",
            name=op.f("ck_review_attempts_local_verdict_valid"),
        ),
        sa.CheckConstraint(
            "grade IS NULL OR grade BETWEEN 1 AND 4", name=op.f("ck_review_attempts_grade_range")
        ),
        sa.CheckConstraint(
            "rt_ms BETWEEN 250 AND 120000", name=op.f("ck_review_attempts_rt_clamped")
        ),
        sa.CheckConstraint(
            "hints_used >= 0 AND plays_used >= 0",
            name=op.f("ck_review_attempts_counts_non_negative"),
        ),
        postgresql_partition_by="RANGE (ts)",
    )

    op.create_table(
        "review_log",
        sa.Column("learner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("attempt_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("memory_item_id", sa.Text(), nullable=False),
        sa.Column("grade", sa.SmallInteger(), nullable=False),
        sa.Column("item_id", sa.Text(), nullable=False),
        sa.Column("type_id", sa.Text(), nullable=False),
        sa.Column("scheduler_version", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("learner_id", "ts", "id", name=op.f("pk_review_log")),
        _learner_fk("review_log"),
        sa.CheckConstraint("grade BETWEEN 1 AND 4", name=op.f("ck_review_log_grade_range")),
        postgresql_partition_by="RANGE (ts)",
    )
    op.create_index(
        "ix_review_log_learner_id_memory_item_id_ts",
        "review_log",
        ["learner_id", "memory_item_id", "ts"],
        postgresql_include=["grade", "item_id"],
    )

    for table in ("review_attempts", "review_log"):
        for month in months_from(FIRST_MONTH, MONTHS):
            name, start, end = month_partition(table, month)
            op.execute(
                f"CREATE TABLE {name} PARTITION OF {table} "
                f"FOR VALUES FROM ('{start.isoformat()}') TO ('{end.isoformat()}')"
            )
        op.execute(f"CREATE TABLE {table}_default PARTITION OF {table} DEFAULT")
        op.execute(
            f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION lep_append_only()"
        )
        op.execute(
            f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON {table} "
            "FOR EACH STATEMENT EXECUTE FUNCTION lep_append_only()"
        )

    op.create_table(
        "memory_state",
        sa.Column("learner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("memory_item_id", sa.Text(), nullable=False),
        sa.Column("stability", sa.Float(), nullable=False),
        sa.Column("difficulty", sa.Float(), nullable=False),
        sa.Column("due", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_review", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_review_day", sa.Date(), nullable=False),
        sa.Column("reviews_today", sa.SmallInteger(), nullable=False),
        sa.Column("reps", sa.Integer(), nullable=False),
        sa.Column("lapses", sa.Integer(), nullable=False),
        sa.Column("lapses_last_30_days", sa.SmallInteger(), nullable=False),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("suspended", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("last_item_id", sa.Text(), nullable=False),
        sa.Column("last_type_id", sa.Text(), nullable=False),
        sa.Column("scheduler_version", sa.Text(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("learner_id", "memory_item_id", name=op.f("pk_memory_state")),
        _learner_fk("memory_state"),
        sa.CheckConstraint(
            "state IN ('learning', 'young', 'retained', 'durable', 'leech', 'suspended', 'retired')",
            name=op.f("ck_memory_state_state_valid"),
        ),
        sa.CheckConstraint("stability > 0", name=op.f("ck_memory_state_stability_positive")),
        sa.CheckConstraint(
            "difficulty BETWEEN 1 AND 10", name=op.f("ck_memory_state_difficulty_range")
        ),
        postgresql_partition_by="HASH (learner_id)",
    )
    op.create_index(
        "ix_memory_state_learner_id_due",
        "memory_state",
        ["learner_id", "due"],
        postgresql_where=sa.text("state NOT IN ('suspended', 'retired')"),
    )
    for i in range(MEMORY_STATE_PARTITIONS):
        op.execute(
            f"CREATE TABLE memory_state_p{i:02d} PARTITION OF memory_state "
            f"FOR VALUES WITH (MODULUS {MEMORY_STATE_PARTITIONS}, REMAINDER {i})"
        )
    op.execute(
        "CREATE TRIGGER memory_state_set_updated_at BEFORE UPDATE ON memory_state "
        "FOR EACH ROW EXECUTE FUNCTION lep_set_updated_at()"
    )

    op.create_table(
        "answer_disputes",
        sa.Column("learner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_uuid", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("review_client_uuid", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'open'"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("learner_id", "client_uuid", name=op.f("pk_answer_disputes")),
        _learner_fk("answer_disputes"),
        sa.CheckConstraint(
            "status IN ('open', 'upheld', 'rejected')", name=op.f("ck_answer_disputes_status_valid")
        ),
    )
    op.create_index("ix_answer_disputes_item_id", "answer_disputes", ["item_id"])

    # Privileges: the logs are insert-and-read only for the API; the rest read and write.
    op.execute(f"GRANT SELECT, INSERT ON review_attempts, review_log TO {APP_ROLE}")
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON review_ingest_keys, memory_state, "
        f"answer_disputes TO {APP_ROLE}"
    )


def downgrade() -> None:
    op.drop_table("answer_disputes")
    op.drop_table("memory_state")
    op.drop_table("review_log")
    op.drop_table("review_attempts")
    op.drop_table("review_ingest_keys")
    op.execute("DROP FUNCTION lep_append_only()")
