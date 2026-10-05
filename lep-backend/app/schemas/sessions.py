"""Composed sessions (docs/08 §5): the request and the plan the server made."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.gamification import Out


class SessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    minutes: int = Field(ge=1, le=60, description="How long the learner wants to practise.")
    node_id: str | None = Field(
        default=None,
        pattern=r"^S\d{2}U\d{2}N[1-8]$",
        description="Play this lesson node; omit for free practice (reviews plus new material).",
    )
    tier: Literal[1, 2, 3] | None = Field(default=None, description="Node tier; 1 when omitted.")

    @model_validator(mode="after")
    def _tier_needs_node(self) -> SessionRequest:
        if self.tier is not None and self.node_id is None:
            raise ValueError("tier needs node_id")
        return self


class SessionStep(Out):
    role: Literal["warmup", "review", "lesson", "close", "break"] = Field(
        description="warmup: an easy start; review: due memory; lesson: new or node material; "
        "close: the weakest item again, another way; break: 15 seconds of rest."
    )
    seconds: float = Field(description="Expected time, from the learner's own response times.")
    item_id: str | None = None
    type_id: str | None = None
    unit_id: str | None = None
    node_id: str | None = None
    tier: int | None = None
    memory_item_id: str | None = None
    target: str | None = None
    modality: str | None = None
    new_targets: list[str] = Field(default_factory=list)


class CatchingUp(Out):
    due: int = Field(description="Memory items due now.")
    normal_per_day: int = Field(description="A normal day of reviews at the learner's daily goal.")
    days_left: int = Field(description="Honest 'catching up: n days left'; 0 without a backlog.")
    new_allowed: bool = Field(description="False while the backlog is over 3x a normal day.")


class SessionOut(Out):
    id: UUID
    kind: Literal["practice", "node"]
    status: Literal["open", "completed"]
    minutes: int
    node_id: str | None
    tier: int | None
    created_at: datetime
    completed_at: datetime | None
    estimated_seconds: float
    steps: list[SessionStep]
    new_targets: list[str] = Field(description="Syllabus targets this session introduces.")
    deferred: list[str] = Field(
        description="Items chosen but left out because no position kept the interleaving rules."
    )
    catching_up: CatchingUp | None = Field(
        default=None, description="Present on a newly composed session."
    )
    new_today: int | None = Field(default=None, description="New targets met earlier today.")
    new_cap: int | None = Field(
        default=None, description="New targets allowed a day at this level."
    )
