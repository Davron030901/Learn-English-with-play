"""Audio assets, synthesised speech, voice recordings and the learner's data controls."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.gamification import Out


class AssetOut(Out):
    path: str
    status: Literal["missing", "tts_draft", "recorded", "qc_passed"]
    source: Literal["none", "synthetic", "recorded"] = Field(
        description="synthetic: a machine voice — the app tells the learner."
    )
    text: str = Field(description="What the audio says.")
    url: str | None = Field(description="Where to fetch it; null while it does not exist.")


class TtsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=400)


class TtsOut(Out):
    url: str
    source: Literal["synthetic"]
    voice: str


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    purpose: Literal["pronunciation", "speaking_task"]
    audio_base64: str = Field(min_length=4, max_length=2_700_000)
    mime: Literal["audio/ogg", "audio/webm", "audio/mp4", "audio/wav", "audio/mpeg"]
    seconds: int = Field(ge=1, le=300)
    item_id: str | None = Field(
        default=None, pattern=r"^item\.\d{7}$", description="pronunciation: the item spoken."
    )
    task_id: str | None = Field(
        default=None, max_length=32, description="speaking_task: the task answered."
    )

    @model_validator(mode="after")
    def _target(self) -> SpeechRequest:
        if self.purpose == "pronunciation" and self.item_id is None:
            raise ValueError("pronunciation needs item_id")
        if self.purpose == "speaking_task" and self.task_id is None:
            raise ValueError("speaking_task needs task_id")
        return self


class SpeechJobOut(Out):
    id: UUID
    status: Literal["queued", "scored", "failed"]
    purpose: str
    expires_at: datetime = Field(description="The recording is deleted then, or sooner on request.")
    result: dict[str, Any] | None = Field(
        description="headline (0–100), passed, at most two notes, per-word scores, transcript; "
        "for a speaking task also the rubric score id."
    )


class SpeakingTaskOut(Out):
    id: str
    level: str
    prompt: str
    seconds: int


class DeletedOut(Out):
    deleted: int


class DeleteAccountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: str = Field(min_length=1, max_length=1024)
