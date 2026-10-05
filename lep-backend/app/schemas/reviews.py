"""Answers and disputes from the app's outbox (backend brief §11, §12).

The request shape is the app's outbox row (``src/outbox/outbox.ts``): every answer was stored on
the device before anything tried to send it, with ``client_uuid`` as the idempotency key. Extra
keys the device keeps for itself (``attempts``, ``status``, ``last_error``, ``seq``) are ignored.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from app.schemas.gamification import AwardsOut

MAX_SUBMISSION_KEYS = 16


class ReviewPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    item_id: str = Field(pattern=r"^item\.\d{7}$")
    session_id: UUID | None = None
    submission: dict[str, Any] = Field(
        description="The answer as the outbox stores it: {kind: choice|text|tiles|order|pairs|"
        "bins|speech|timeout, …}. Never a recording.",
        max_length=MAX_SUBMISSION_KEYS,
    )
    rt_ms: int = Field(ge=0, le=86_400_000, description="Clamped to [250, 120000] on the server.")
    hints_used: int = Field(default=0, ge=0, le=1_000)
    plays_used: int = Field(default=0, ge=0, le=10_000)
    started_at: AwareDatetime | None = None
    content_version: str = Field(min_length=1, max_length=64)
    local_verdict: Literal["correct", "incorrect", "ungraded"] | None = None
    local_typo: bool = False


class DisputePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    review_client_uuid: UUID
    item_id: str = Field(pattern=r"^item\.\d{7}$")


class ReviewRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: Literal["review"]
    client_uuid: UUID
    created_at: AwareDatetime = Field(description="When the learner answered (device clock).")
    monotonic_ms: int = Field(default=0, ge=0)
    payload: ReviewPayload


class DisputeRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: Literal["dispute"]
    client_uuid: UUID
    created_at: AwareDatetime
    monotonic_ms: int = Field(default=0, ge=0)
    payload: DisputePayload


OutboxRecord = Annotated[ReviewRecord | DisputeRecord, Field(discriminator="kind")]


class SyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    records: list[OutboxRecord] = Field(min_length=1, max_length=500)


class Typo(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    typed: str
    expected: str


class RecordResult(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    client_uuid: UUID
    status: Literal["accepted", "duplicate", "rejected"] = Field(
        description="duplicate: this client_uuid was ingested before; nothing was written again."
    )
    verdict: Literal["correct", "incorrect", "ungraded"] | None = None
    grade: int | None = Field(
        default=None, ge=1, le=4, description="The FSRS grade (docs/08 §2.3)."
    )
    typo: Typo | None = None
    problem: str | None = Field(
        default=None, description="Why a record was rejected: unknown_item, invalid_submission."
    )


class SyncResponse(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    results: list[RecordResult]
    awards: AwardsOut = Field(description="What these answers earned (docs/16 E00).")
    server_time: datetime
    due_now: int = Field(description="Memory items due for review at server_time.")
