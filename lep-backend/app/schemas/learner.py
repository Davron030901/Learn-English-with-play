"""Learner profile."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class LearnerSettingsOut(BaseModel):
    desired_retention: float = Field(description="0.85 Relaxed · 0.90 Balanced · 0.94 Thorough")
    rest_days: list[int] = Field(description="ISO weekdays, 1 = Monday … 7 = Sunday; at most 2")
    leagues_opt_in: bool
    league_tier: int = Field(
        default=1, ge=1, le=10, description="1 Clay … 10 Diamond; kept 4 weeks after leaving."
    )
    perfectionist_mode: bool
    data_collection_paused: bool
    spelling_variant: Literal["us", "uk"]
    voice_consent: bool = Field(
        default=False, description="Agreed to voice recording and scoring (kept 30 days at most)."
    )
    training_opt_in: bool = Field(
        default=False,
        description="A separate, explicit opt-in to recordings improving the scorer; off by default.",
    )
    a11y_no_audio: bool = Field(
        default=False,
        description="Choose exercises that need no hearing: sound-only types are never chosen, "
        "listening types only when nothing else reviews the item.",
    )
    a11y_no_vision: bool = Field(
        default=False,
        description="Choose exercises that need no sight: the visual-memory game and the timed "
        "race only when nothing else reviews the item.",
    )


class LearnerOut(BaseModel):
    id: UUID
    email: str
    l1: str
    birth_year: int
    is_minor: bool = Field(
        description="Derived: true while the learner might be under 18 (year-only birth date)."
    )
    tz: str
    display_name: str | None = Field(
        default=None, description="Seen by others only in a league the learner joined."
    )
    daily_goal_min: int
    status: str
    created_at: datetime
    settings: LearnerSettingsOut
