"""Opt-in weekly leagues (docs/16 E23).

The only place the API shows learners side by side, and only to learners who chose it: a
group's rows carry display names and weekly XP — never an id, an email, a level or a streak.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.gamification import Out


class LeagueRow(Out):
    rank: int
    display_name: str | None = Field(description="The name the learner chose to be seen by.")
    weekly_xp: int = Field(description="XP from scheduled work and immersion; re-grind is 0.")
    you: bool
    zone: Literal["up", "down"] | None = Field(
        description="Where this place would go if the week ended now: the top 7 move up; from "
        "tier 3 the bottom 5 move down; tiers 1 and 2 never move down."
    )


class LeagueOut(Out):
    id: UUID
    tier: int = Field(ge=1, le=10, description="1 Clay … 10 Diamond; the app names them.")
    members: list[LeagueRow]


class LeagueResultOut(Out):
    week_starts_at: datetime
    week_ends_at: datetime
    tier_before: int
    tier_after: int
    rank: int
    moved: Literal[-1, 0, 1] = Field(description="0 also when the streak was paused.")
    weekly_xp: int
    members: int


class LeagueStatusOut(Out):
    opted_in: bool = Field(description="Off by default and never turned on by the server.")
    eligible: bool = Field(description="False for a learner who might be under 18.")
    tier: int = Field(ge=1, le=10)
    week_starts_at: datetime
    week_ends_at: datetime = Field(description="Sunday 20:00 in Tashkent, the same for everyone.")
    league: LeagueOut | None = Field(
        description="This week's group; none until the learner's first XP of the week."
    )
    result: LeagueResultOut | None = Field(
        description="The last settled week, until the app has shown it (POST /result-seen)."
    )


class LeagueHistoryOut(Out):
    weeks: list[LeagueResultOut]
    next_cursor: str | None
