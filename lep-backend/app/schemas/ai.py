"""The AI conversation partner (docs/16 E21)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.gamification import AwardsOut


class Out(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class AiStatusOut(Out):
    available: bool = Field(description="False when the server has no model configured.")
    daily_limit: int
    used_today: int
    max_turns: int
    retention_days: int = Field(description="Transcripts are deleted after this many days.")


class CharacterOut(Out):
    id: str
    name: str
    role: dict[str, str]
    first_unit: str
    ai: bool = Field(default=True, description="Always true: an AI character, not a person.")


class ScenarioOut(Out):
    unit_id: str
    cefr: str
    title: dict[str, str]
    can_do: list[str]
    characters: list[str]


class CastOut(Out):
    characters: list[CharacterOut]
    scenarios: list[ScenarioOut]


class StartConversation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_id: str = Field(min_length=1, max_length=32)
    unit_id: str = Field(pattern=r"^S\d{2}U\d{2}$")
    mode: Literal["fluency", "accuracy"] = "accuracy"


class SubgoalOut(Out):
    id: str
    text: str


class ConversationOut(Out):
    id: UUID
    character_id: str
    unit_id: str
    mode: str
    opening_line: str
    subgoals: list[SubgoalOut]
    starters: list[str] = Field(description="Phrases from the unit for the Help button.")
    max_turns: int
    expires_at: datetime


class TurnIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_uuid: UUID = Field(description="Retry with the same id: the turn is not repeated.")
    text: str = Field(min_length=1, max_length=500)
    rt_ms: int | None = Field(
        default=None, ge=0, le=600_000, description="Thinking and typing time, for the goal."
    )


class RecastOut(Out):
    original: str
    corrected: str
    start: int | None = Field(description="Where the corrected form sits in the reply.")
    end: int | None


class TurnOut(Out):
    reply: str
    recasts: list[RecastOut] = Field(description="Shown during the chat in accuracy mode only.")
    subgoals_met: list[str]
    turn: int
    max_turns: int
    ended: bool
    goal_met: bool
    off_limits: bool
    awards: AwardsOut


class FocusItemOut(Out):
    original: str
    corrected: str


class SummaryOut(Out):
    goal_met: bool
    subgoals_met: list[str]
    focus_items: list[FocusItemOut] = Field(description="Two things to work on, at most.")
    words_used: list[str]
    xp: int
    turns: int


class MessageOut(Out):
    seq: int
    role: Literal["learner", "character"]
    text: str
    recasts: list[dict[str, str]]
    at: datetime


class TranscriptOut(Out):
    id: UUID
    character_id: str
    unit_id: str
    mode: str
    status: str
    subgoals: list[SubgoalOut]
    met: list[str]
    turns: int
    created_at: datetime
    expires_at: datetime
    messages: list[MessageOut]
    summary: dict[str, Any] | None
