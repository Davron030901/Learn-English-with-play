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


class PaperReportOut(Out):
    paper: str
    score: float = Field(description="Share of the paper's items answered right.")
    asked: int
    answered: int
    correct: int
    paper_bar: float = Field(description="No paper below this (docs/12 §4.3).")
    overall_bar: float = Field(description="The overall share the level asks for.")
    band: Literal["secure", "pass", "borderline", "below"] = Field(
        description="secure: 10 points or more above the overall bar; pass: at or above it; "
        "borderline: above the paper bar only; below: under the paper bar."
    )
    median_seconds: float | None = Field(description="Median seconds per answer on this paper.")


class SkillOut(Out):
    skill: Literal["listening", "reading", "language", "writing", "speaking"]
    value: float | None = Field(
        description="A share (listening, reading, language) or a rubric band 1–6 (writing, "
        "speaking); null when the skill has not been assessed at this level yet."
    )
    target: float = Field(description="What the level asks for, on the same scale.")
    scale: Literal["share", "band"]


class ErrorTypeOut(Out):
    kind: Literal["vocabulary", "grammar", "function", "pronunciation", "comprehension"]
    asked: int
    wrong: int


class WorkOnOut(Out):
    target: str = Field(description="A syllabus target: a lexeme, grammar point, function …")
    kind: Literal["vocabulary", "grammar", "function", "pronunciation"]
    wrong: int
    asked: int
    label: str | None = Field(description="The target in words (a headword, a grammar point).")
    unit_id: str | None = Field(description="The first unit that teaches it: where to practise.")


class VocabularyOut(Out):
    known_lexemes: int
    level_known: int = Field(description="Known lexemes of this level.")
    level_total: int
    estimate_percent: float = Field(
        description="About how much of everyday English the known words cover — an estimate."
    )


class FluencyOut(Out):
    reading_target_wpm: str = Field(description="docs/06 §1.2, at the top of the level.")
    speech_target_wpm: str = Field(description="docs/06 §1.3, at the top of the level.")
    speech_rate_wpm: float | None = Field(
        description="Measured once recorded speech is scored; never estimated."
    )


class TimelineOut(Out):
    next_level: str | None
    units_left: int = Field(description="Units not yet completed up to the end of the next level.")
    units_per_week: float | None = Field(description="Units completed a week, the last 4 weeks.")
    weeks: int | None = Field(description="At that pace; null when there is no pace yet.")
    reason: Literal["", "top_level", "no_pace"]


class ExamReportOut(Out):
    """docs/12 §9.2 — and §9.3: no comparison with others, no unexplained single score, no
    external band, no number the evidence does not support."""

    id: UUID
    level: str
    completed_at: datetime
    passed: bool
    overall: float = Field(description="The mean of the papers; read it with the papers.")
    papers: list[PaperReportOut]
    skills: list[SkillOut]
    error_types: list[ErrorTypeOut]
    error_norms: None = Field(
        description="Level norms need answers from many learners; none exist yet, so none "
        "are shown (always null)."
    )
    work_on: list[WorkOnOut] = Field(description="At most five targets, most often wrong first.")
    vocabulary: VocabularyOut
    fluency: FluencyOut
    timeline: TimelineOut
    note: str = Field(
        default="An internal assessment, not an accredited qualification.",
        description="docs/12 §4: every result says so in plain language.",
    )


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
