"""Level exams, production scores, appeals, the level award and the retention audit (Phase 7)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.gamification import Out

Level = Literal["A1", "A2", "B1", "B2", "C1", "C2"]


class ExamRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    level: Level


class ExamOut(Out):
    id: UUID
    level: str
    papers: dict[str, list[str]] = Field(
        description="Paper → item ids. Answer them through POST /v1/sync/reviews with session_id = id."
    )
    pass_overall: float
    pass_paper: float
    created_at: datetime
    ends_at: datetime = Field(
        description="Answers the server receives after this do not count (docs/12 §4.1 timings)."
    )
    reused: bool = Field(
        description="True when the form had to reuse items from an earlier exam (no exam bank)."
    )


class ExamResultOut(Out):
    id: UUID
    level: str
    scores: dict[str, float] = Field(description="Paper → share right; unanswered counts as wrong.")
    overall: float
    passed: bool


class WritingTaskOut(Out):
    id: str
    level: str
    prompt: str
    min_words: int
    max_words: int


class WritingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1, max_length=32)
    text: str = Field(min_length=1, max_length=6000)


class CriterionOut(Out):
    criterion: str
    band: float
    evidence: list[str] = Field(description="The learner's own sentences that anchored the band.")


class ScoreOut(Out):
    id: UUID
    kind: str
    level: str
    overall: float = Field(description="Median of the criteria, capped by any weak criterion.")
    criteria: list[CriterionOut]
    rater: str = Field(description="Rater kind and version, e.g. llm / claude:…:writing-rater-…")
    certifying: bool = Field(
        description="False: formative feedback only (the rater is not calibrated at κ ≥ 0.75)."
    )
    borderline: bool = Field(description="Within 5 % of the level's band: a human checks it.")
    created_at: datetime


class SubmissionOut(Out):
    submission_id: UUID
    status: Literal["awaiting_rater", "scored"]
    score: ScoreOut | None


class AppealRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score_id: UUID
    reason: str = Field(min_length=1, max_length=2000)


class AppealOut(Out):
    id: UUID
    score_id: UUID
    status: str


class ConditionOut(Out):
    name: Literal["coverage", "retention", "exam", "production"]
    passed: bool
    value: float | None
    threshold: float
    shortfall: str = Field(description="What is short and by how much; empty when passed.")


class LevelAwardOut(Out):
    level: str
    awarded: bool
    conditions: list[ConditionOut] = Field(description="All four, each with its computed value.")
    message: str | None = Field(
        description="The honest docs/12 §4.3 message when the exam passed on fragile memory."
    )
    remediation: list[str]
    recorded: bool = Field(description="True when this evaluation was stored as evidence.")


class RetentionAuditOut(Out):
    id: UUID
    item_ids: list[str] = Field(
        description="Answer through POST /v1/sync/reviews with session_id = id."
    )
    predicted: float = Field(description="Recall the memory model predicts for these items now.")
    actual: float | None = None
    raised_retention: float | None = Field(
        default=None,
        description="Set when recall was materially below the prediction and the "
        "desired retention stepped up.",
    )
