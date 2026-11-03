"""Learner identity and settings.

The CHECK constraints repeat the API's validation on purpose: the database is the last
line of defence against a bug, a script or a future endpoint that skips the schema.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Numeric,
    SmallInteger,
    Text,
    false,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

LEARNER_STATUSES = ("active", "suspended", "deleted")
DAILY_GOAL_CHOICES = (5, 10, 20, 40)  # docs/10 §5 via the brief §9.2
RETENTION_PRESETS = ("0.85", "0.90", "0.94")  # docs/08 §2 via the brief §6.3
SPELLING_VARIANTS = ("us", "uk")  # docs/00 §2.1
L1_PATTERN_SQL = "^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$"


class Learner(Base):
    __tablename__ = "learners"

    id: Mapped[UUID] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(CITEXT, unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    l1: Mapped[str] = mapped_column(Text)
    birth_year: Mapped[int] = mapped_column(SmallInteger)
    tz: Mapped[str] = mapped_column(Text)
    daily_goal_min: Mapped[int] = mapped_column(SmallInteger, server_default=text("10"))
    status: Mapped[str] = mapped_column(Text, server_default=text("'active'"))
    #: the name other learners may see (leagues, docs/16 E23); none until the learner picks one
    display_name: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (
        CheckConstraint("length(email) BETWEEN 3 AND 254", name="email_length"),
        CheckConstraint(
            "display_name IS NULL OR char_length(display_name) BETWEEN 2 AND 24",
            name="display_name_length",
        ),
        CheckConstraint(f"l1 ~ '{L1_PATTERN_SQL}'", name="l1_language_tag"),
        CheckConstraint("birth_year BETWEEN 1900 AND 2100", name="birth_year_range"),
        CheckConstraint("length(tz) BETWEEN 1 AND 64", name="tz_length"),
        CheckConstraint(
            f"daily_goal_min IN ({', '.join(map(str, DAILY_GOAL_CHOICES))})",
            name="daily_goal_choice",
        ),
        CheckConstraint(
            f"status IN ({', '.join(repr(s) for s in LEARNER_STATUSES)})", name="status_valid"
        ),
    )


class LearnerSettings(Base):
    __tablename__ = "learner_settings"

    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    desired_retention: Mapped[Decimal] = mapped_column(Numeric(3, 2), server_default=text("0.90"))
    #: ISO weekday numbers, 1 = Monday … 7 = Sunday; at most two (docs/10 §5).
    rest_days: Mapped[list[int]] = mapped_column(
        ARRAY(SmallInteger), server_default=text("'{}'::smallint[]")
    )
    leagues_opt_in: Mapped[bool] = mapped_column(server_default=false())
    #: the league tier, 1 Clay … 10 Diamond; kept for four weeks after leaving (docs/16 E23)
    league_tier: Mapped[int] = mapped_column(SmallInteger, server_default=text("1"))
    leagues_left_at: Mapped[datetime | None]
    perfectionist_mode: Mapped[bool] = mapped_column(server_default=false())
    data_collection_paused: Mapped[bool] = mapped_column(server_default=false())
    #: the learner agreed to their voice being recorded and scored (docs/11 §10)
    voice_consent: Mapped[bool] = mapped_column(server_default=false())
    #: a separate, explicit opt-in to recordings being used to improve the scorer; never implied
    training_opt_in: Mapped[bool] = mapped_column(server_default=false())
    spelling_variant: Mapped[str] = mapped_column(Text, server_default=text("'us'"))
    #: the accessibility profile (docs/00 §6): exercises are chosen so that none needs hearing,
    #: or sight, that the learner does not have
    a11y_no_audio: Mapped[bool] = mapped_column(server_default=false())
    a11y_no_vision: Mapped[bool] = mapped_column(server_default=false())
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            f"desired_retention IN ({', '.join(RETENTION_PRESETS)})", name="retention_preset"
        ),
        CheckConstraint(
            "rest_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[] AND cardinality(rest_days) <= 2",
            name="rest_days_valid",
        ),
        CheckConstraint(
            f"spelling_variant IN ({', '.join(repr(s) for s in SPELLING_VARIANTS)})",
            name="spelling_variant_valid",
        ),
        CheckConstraint("league_tier BETWEEN 1 AND 10", name="league_tier_range"),
    )
