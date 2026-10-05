"""The motivation layer's responses (docs/10, docs/16 E00–E15).

Coverage and progress come first (docs/10 §4.1); XP, streak and gems are secondary and are
documented as what they measure. No response contains a rank against other learners.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Out(BaseModel):
    """Response models: a field with a default is still always sent, so the schema says so."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class Goal(Out):
    goal_min: int = Field(description="The learner's own daily goal: 5, 10, 20 or 40 minutes.")
    minutes_today: float = Field(description="Time on task today (answers plus reading feedback).")
    met: bool
    met_now: bool = Field(default=False, description="Met by the answers in this request.")


class StreakOut(Out):
    current: int
    longest: int
    freezes: int = Field(description="Free and automatic: at most 2, one back every 5 days.")
    today_counted: bool
    rest_days: list[int] = Field(description="ISO weekdays that never break the streak.")
    paused_until: date | None
    can_repair: bool = Field(description="Broken within 48 hours and not repaired this month.")
    milestone_now: int | None = Field(
        default=None, description="7, 30, 100 or 365 if just reached."
    )
    reset_message: str | None = Field(
        default=None, description="docs/10 §5's kind message, until acknowledged."
    )


class QuestOut(Out):
    id: str
    period: Literal["day", "week"]
    metric: str
    title: dict[str, str] = Field(description="en, uz and ru.")
    progress: int
    target: int
    completed: bool
    completed_now: bool = False
    gems: int


class BadgeOut(Out):
    id: str = Field(description="<unit_id>:<n>, the unit's n-th can-do statement.")
    unit_id: str
    text: str
    awarded_at: datetime


class NodeTier(Out):
    node_id: str
    tier: int


class AwardsOut(Out):
    """What the answers in one request earned. Empty when nothing new happened."""

    xp: int = 0
    gems: int = 0
    goal: Goal | None = None
    streak: StreakOut | None = None
    quests_completed: list[QuestOut] = Field(default_factory=list)
    nodes_completed: list[NodeTier] = Field(default_factory=list)
    units_completed: list[str] = Field(default_factory=list)
    sections_completed: list[str] = Field(default_factory=list)
    badges: list[BadgeOut] = Field(default_factory=list)
    best_run: int = 0


class GamificationSummary(Out):
    as_of: datetime
    today: date = Field(description="The learner's local calendar day.")
    xp_today: int
    xp_week: int
    xp_total: int
    gems: int = Field(description="Earned only; spendable on cosmetics, never on learning.")
    goal: Goal
    streak: StreakOut
    daily_quests: list[QuestOut]
    weekly_quests: list[QuestOut]
    unseen_badges: list[BadgeOut]


class PauseRequest(BaseModel):
    days: int = Field(ge=1, le=30)


class BadgesSeenRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=200)


RETENTION_PRESETS = (0.85, 0.90, 0.94)


class SettingsPatch(BaseModel):
    daily_goal_min: Literal[5, 10, 20, 40] | None = None
    desired_retention: float | None = Field(
        default=None, description="A preset: 0.85 relaxed, 0.90 balanced, 0.94 thorough."
    )
    rest_days: list[int] | None = Field(default=None, max_length=2)
    leagues_opt_in: bool | None = None
    perfectionist_mode: bool | None = None
    spelling_variant: Literal["us", "uk"] | None = None
    voice_consent: bool | None = Field(
        default=None, description="Withdrawing consent deletes every stored recording."
    )
    training_opt_in: bool | None = None
    data_collection_paused: bool | None = Field(
        default=None, description="While paused, no recordings or writing are accepted."
    )

    @field_validator("desired_retention")
    @classmethod
    def _preset(cls, value: float | None) -> float | None:
        if value is not None and value not in RETENTION_PRESETS:
            raise ValueError("must be one of the presets 0.85, 0.90 or 0.94")
        return value


# ------------------------------------------------------------------- progress


class CoverageOut(Out):
    known_lexemes: int = Field(
        description="Lexemes whose weakest exercised aspect is retained (S ≥ 21 d) — docs/08 §3."
    )
    learning_lexemes: int = Field(description="Seen but not yet known.")
    total_lexemes: int
    estimate_percent: float = Field(
        description="About how much of everyday English the known words cover. An estimate "
        "(Zipf over the course order) until the monthly retention audit has run."
    )
    method: str
    audited: bool


class UnitStatus(Out):
    unit_id: str
    tiers: dict[str, int] = Field(description="node_id → the highest tier completed.")
    completed: bool


class LevelOut(Out):
    cefr: str = Field(description="The sub-level of the learner's current unit.")
    units_done: int
    units_total: int
    percent: float


class ProgressOut(Out):
    coverage: CoverageOut
    level: LevelOut
    units: list[UnitStatus] = Field(description="Units with any completed node, in course order.")
    current_unit: str
    badges: list[BadgeOut]


# ------------------------------------------------------------------- garden


class GardenSummary(Out):
    as_of: datetime
    due_count: int = Field(description="Words due for watering now.")
    est_minutes: int
    stages: dict[str, int] = Field(description="seed, sprout, bush, bloom, tree, leech, paused.")
    audited: bool


class Plant(Out):
    lexeme_id: str
    lemma: str
    stage: Literal["seed", "sprout", "bush", "bloom", "tree", "leech", "paused"]
    #: retrievability now of the weakest exercised aspect (the plant's health)
    health: float = Field(ge=0, le=1)
    due_at: datetime
    thirsty: bool
    aspects: dict[str, str] = Field(description="aspect → mastery state of that memory item.")


class GardenBed(Out):
    unit_id: str
    title: dict[str, str]
    plants: list[Plant]


class GardenBeds(Out):
    beds: list[GardenBed]
    next_cursor: str | None


class SessionSummary(Out):
    session_id: str
    answers: int
    correct: int
    graded: int
    xp: int
    nodes_completed: list[NodeTier]


class DueItem(Out):
    memory_item_id: str
    item_id: str = Field(description="An exercise that reviews it, not the type used last time.")
    due_at: datetime
    retrievability: float


class DueQueue(Out):
    as_of: datetime
    total_due: int
    items: list[DueItem]
