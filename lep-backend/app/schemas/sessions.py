"""Composed sessions (docs/08 §5): the request and the plan the server made."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.gamification import Out


class A11yProfileIn(BaseModel):
    """docs/00 §6: no exercise type may be the only route to an item."""

    model_config = ConfigDict(extra="forbid")

    no_audio: bool = Field(default=False, description="The learner cannot use audio.")
    no_vision: bool = Field(default=False, description="The learner cannot use the screen.")


class A11yProfileOut(Out):
    no_audio: bool
    no_vision: bool


class SessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    minutes: int = Field(ge=1, le=60, description="How long the learner wants to practise.")
    node_id: str | None = Field(
        default=None,
        pattern=r"^S\d{2}U\d{2}N[1-8]$",
        description="Play this lesson node; omit for free practice (reviews plus new material).",
    )
    tier: Literal[1, 2, 3] | None = Field(default=None, description="Node tier; 1 when omitted.")
    a11y_profile: A11yProfileIn | None = Field(
        default=None,
        description="Choose exercises for this profile; omitted: the profile saved in settings "
        "(`a11y_no_audio`, `a11y_no_vision`).",
    )

    @model_validator(mode="after")
    def _tier_needs_node(self) -> SessionRequest:
        if self.tier is not None and self.node_id is None:
            raise ValueError("tier needs node_id")
        return self


class SessionStep(Out):
    role: Literal["warmup", "review", "lesson", "close", "break", "recovery"] = Field(
        description="warmup: an easy start; review: due memory; lesson: new or node material; "
        "close: the weakest item again, another way; break: 15 seconds of rest; recovery: a "
        "near-certain item, played only to keep a session from ending on a failure."
    )
    phase: Literal[
        "warmup", "review", "new_input", "guided", "integration", "production", "close", "break"
    ] = Field(
        description="The part of the session shape it belongs to (docs/07 §3.2). A lesson item "
        "is guided practice for the first 60 % of the lesson's practice items, integration after "
        "them, production when it is speaking or free writing. No item is new_input: new words "
        "and grammar are presented by the app, never tested, before the first lesson item."
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
    recovery: list[SessionStep] = Field(
        description="Up to two items the learner is almost sure to get right (p ≥ 0.95, nothing "
        "new, not in the plan): when the last answer before CLOSE was wrong, play one first, so "
        "a session never ends on a failure (docs/07 §3.2). Not part of `estimated_seconds`."
    )
    withheld: list[str] = Field(
        description="Lesson items the accessibility profile has no form for, left out of the "
        "plan. The node-tier is passed on the items that can be shown."
    )
    a11y_profile: A11yProfileOut = Field(description="The profile the exercises were chosen for.")
    catching_up: CatchingUp | None = Field(
        default=None, description="Present on a newly composed session."
    )
    new_today: int | None = Field(default=None, description="New targets met earlier today.")
    new_cap: int | None = Field(
        default=None, description="New targets allowed a day at this level."
    )
