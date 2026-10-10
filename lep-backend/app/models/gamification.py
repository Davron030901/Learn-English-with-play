"""Progress and the motivation layer (backend brief Phase 6, docs/10, docs/16).

Everything here is derived from accepted answers at ingest time and is honest by construction:
XP is effort on scheduled work, a node-tier counts only when the server saw it passed, a badge
is a can-do statement of a unit the learner completed, and gems are earned only (there is no
purchase path for anything that affects learning).
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

GEM_REASONS = ("daily_goal", "quest", "unit_complete", "checkpoint", "weekly_immersion", "purchase")


def _fk() -> ForeignKey:
    return ForeignKey("learners.id", ondelete="CASCADE")


class LearnerDay(Base):
    """One learner-local calendar day of activity: the daily goal, quests and the streak read it."""

    __tablename__ = "learner_days"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    day: Mapped[date] = mapped_column(primary_key=True)
    answers: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    correct: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    #: time on task: response times plus a fixed allowance per answer for reading feedback
    active_ms: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    xp_centi: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    run_now: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))
    best_run: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))
    speaking: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    listening: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    reviewed_due: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    nodes_completed: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    goal_met_at: Mapped[datetime | None]

    __table_args__ = (
        CheckConstraint(
            "answers >= 0 AND correct >= 0 AND active_ms >= 0 AND xp_centi >= 0",
            name="non_negative",
        ),
    )


class XpEvent(Base):
    """XP as it was earned, one row per answer or immersion event (append-only by convention)."""

    __tablename__ = "xp_events"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    ts: Mapped[datetime]
    day: Mapped[date]
    source: Mapped[str] = mapped_column(Text)
    xp_centi: Mapped[int] = mapped_column(Integer)
    attempt_id: Mapped[UUID | None]
    session_id: Mapped[UUID | None]
    regrind: Mapped[bool] = mapped_column(server_default=text("false"))

    __table_args__ = (
        CheckConstraint(
            "source IN ('answer', 'reading', 'listening', 'writing', 'conversation')",
            name="source_valid",
        ),
        CheckConstraint("xp_centi >= 0", name="xp_non_negative"),
        Index("ix_xp_events_learner_id_session_id", "learner_id", "session_id"),
        # a league's weekly XP: its members' events in one week
        Index("ix_xp_events_learner_id_ts", "learner_id", "ts"),
    )


class Streak(Base):
    """The learner's streak (docs/10 §5) — see app.domain.streaks for the rules."""

    __tablename__ = "streaks"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    current: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    longest: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    last_counted: Mapped[date | None]
    settled_through: Mapped[date | None]
    freezes: Mapped[int] = mapped_column(SmallInteger, server_default=text("2"))
    freeze_clock: Mapped[date | None]
    paused_from: Mapped[date | None]
    paused_until: Mapped[date | None]
    broken_on: Mapped[date | None]
    broken_length: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    repaired_month: Mapped[str | None] = mapped_column(Text)
    #: the length of the last streak that reset, until the app has shown the kind message once
    unseen_reset_from: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (
        CheckConstraint("freezes BETWEEN 0 AND 2", name="freezes_range"),
        CheckConstraint("current >= 0 AND longest >= current", name="lengths_valid"),
    )


class GemLedger(Base):
    """Gems, earned only (docs/10 §9). One row per award; (reason, ref) makes awards idempotent."""

    __tablename__ = "gem_ledger"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    ts: Mapped[datetime]
    amount: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    ref: Mapped[str] = mapped_column(Text)

    __table_args__ = (
        UniqueConstraint("learner_id", "reason", "ref", name="uq_gem_ledger_learner_id_reason_ref"),
        CheckConstraint(
            f"reason IN ({', '.join(repr(r) for r in GEM_REASONS)})", name="reason_valid"
        ),
        CheckConstraint("(reason = 'purchase') = (amount < 0)", name="sign_matches_reason"),
    )


class NodeProgress(Base):
    """A node-tier the server saw passed (docs/08 §4.3)."""

    __tablename__ = "node_progress"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    node_id: Mapped[str] = mapped_column(Text, primary_key=True)
    tier: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    completed_at: Mapped[datetime]
    accuracy: Mapped[float | None] = mapped_column(Float)
    session_id: Mapped[UUID | None]
    #: passed by a test-out rather than by playing the tier (docs/10 §4)
    tested_out: Mapped[bool] = mapped_column(server_default=text("false"))

    __table_args__ = (CheckConstraint("tier BETWEEN 1 AND 3", name="tier_range"),)


class UnitProgress(Base):
    __tablename__ = "unit_progress"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    unit_id: Mapped[str] = mapped_column(Text, primary_key=True)
    completed_at: Mapped[datetime]


class Badge(Base):
    """English Passport stamps: a unit's can-do statements, awarded when the unit is complete."""

    __tablename__ = "badges"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    badge_id: Mapped[str] = mapped_column(Text, primary_key=True)
    unit_id: Mapped[str] = mapped_column(Text)
    awarded_at: Mapped[datetime]
    #: shown in a celebration already (rare celebrations, docs/10 §10)
    seen: Mapped[bool] = mapped_column(server_default=text("false"))


class Cosmetic(Base):
    """A cosmetic the learner owns (Pip outfits, themes, path skins) — never content."""

    __tablename__ = "cosmetics"

    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    item_id: Mapped[str] = mapped_column(Text, primary_key=True)
    acquired_at: Mapped[datetime]
    equipped: Mapped[bool] = mapped_column(server_default=text("false"))


class League(Base):
    """One weekly group of at most 30 opted-in learners of one tier (docs/16 E23)."""

    __tablename__ = "leagues"

    id: Mapped[UUID] = mapped_column(primary_key=True)
    week_starts_at: Mapped[datetime]
    tier: Mapped[int] = mapped_column(SmallInteger)
    #: the first member's XP the week before, in whole XP: who this group is matched for
    seed_xp: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime]
    settled_at: Mapped[datetime | None]

    __table_args__ = (
        CheckConstraint("tier BETWEEN 1 AND 10", name="tier_range"),
        CheckConstraint("seed_xp >= 0", name="seed_non_negative"),
        Index("ix_leagues_week_starts_at_tier", "week_starts_at", "tier"),
        Index(
            "ix_leagues_unsettled", "week_starts_at", postgresql_where=text("settled_at IS NULL")
        ),
    )


class LeagueMember(Base):
    """A learner's week in a league. The weekly XP is read from ``xp_events`` until the week is
    settled; then the result is kept here, and applied to the learner's tier on their next
    request (``tier_applied``)."""

    __tablename__ = "league_members"

    league_id: Mapped[UUID] = mapped_column(
        ForeignKey("leagues.id", ondelete="CASCADE"), primary_key=True
    )
    learner_id: Mapped[UUID] = mapped_column(_fk(), primary_key=True)
    #: the league's week, repeated so a learner is in one league a week at most
    week_starts_at: Mapped[datetime]
    joined_at: Mapped[datetime]
    final_xp_centi: Mapped[int | None] = mapped_column(Integer)
    final_rank: Mapped[int | None] = mapped_column(SmallInteger)
    moved: Mapped[int | None] = mapped_column(SmallInteger)
    tier_after: Mapped[int | None] = mapped_column(SmallInteger)
    tier_applied: Mapped[bool] = mapped_column(server_default=text("false"))
    #: the week's result was shown in the app
    result_seen: Mapped[bool] = mapped_column(server_default=text("false"))

    __table_args__ = (
        UniqueConstraint(
            "learner_id", "week_starts_at", name="uq_league_members_learner_id_week_starts_at"
        ),
        CheckConstraint("moved IN (-1, 0, 1)", name="moved_valid"),
        CheckConstraint("tier_after BETWEEN 1 AND 10", name="tier_after_range"),
        CheckConstraint(
            "(final_rank IS NULL) = (moved IS NULL) AND (moved IS NULL) = (tier_after IS NULL)",
            name="result_complete",
        ),
    )
