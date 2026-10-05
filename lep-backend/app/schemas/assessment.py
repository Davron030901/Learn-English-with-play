"""Test-out checkpoints, placement and the cosmetic shop."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.gamification import AwardsOut


class Out(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class CheckpointRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit_id: str = Field(pattern=r"^S\d{2}U\d{2}$")


class CheckpointOut(Out):
    checkpoint_id: UUID = Field(
        description="Send the answers through POST /v1/sync/reviews with this as session_id."
    )
    unit_id: str
    item_ids: list[str]
    pass_percent: int = Field(description="85: free, unlimited, any time (docs/10 §4).")


class CheckpointResultOut(Out):
    passed: bool
    accuracy: float | None
    answered: int
    total: int
    awards: AwardsOut


class PlacementAnswers(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answers: dict[str, dict[str, Any]] = Field(
        description="item_id → the submission, in the outbox's shape.", max_length=20
    )


class PlacementOut(Out):
    placement_id: UUID
    done: bool
    level: str | None = Field(description="The sub-level this stage tests.")
    item_ids: list[str]
    unit_ids: list[str] = Field(description="The units this stage's items come from, to load.")
    result_level: str | None
    result_section: str | None
    result_unit: str | None = Field(description="Where to start: the first unit of that level.")


class ShopItemOut(Out):
    id: str
    kind: Literal["pip_outfit", "theme", "path_skin"]
    price: int
    name: dict[str, str]
    owned: bool
    equipped: bool


class ShopOut(Out):
    gems: int
    items: list[ShopItemOut]
    note: str = Field(description="Gems buy looks only — never lessons, hints, freezes or tests.")


class ShopAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: str = Field(min_length=1, max_length=64)


class CompletedAt(Out):
    completed_at: datetime
