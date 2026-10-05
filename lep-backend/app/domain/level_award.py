"""The level award: the single most important integrity rule (docs/00 §7, docs/12 §4.3). Pure.

A level is **not** awarded for finishing nodes. All four must hold, and each is reported
separately with its computed value, so the learner is told which one failed and by how much:

1. **Coverage** — ≥ 95 % of the level's syllabus items introduced and passed at tier ≥ 2.
2. **Retention** — ≥ 85 % of the level's memory items retained or better (S ≥ 21 d) *now*.
3. **Exam** — the level exam's papers: ≥ 75 % overall and no paper below 60 % (C2: 80 / 70).
4. **Production** — writing and speaking at or above the level's rubric band by the automatic
   scorer **and**, from B1, by a certifying rater (a human, or a machine rater whose κ against
   the human panel is ≥ 0.75).

A learner who passes the exam on fragile memory is told so, in the words of docs/12 §4.3, and
is not given a certificate.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Final, Literal

from app.domain.rubric import LEVEL_BAND

LEVELS: Final = ("A1", "A2", "B1", "B2", "C1", "C2")
COVERAGE_MIN: Final = 0.95
RETENTION_MIN: Final = 0.85
#: docs/12 §4.3: (overall, every paper)
EXAM_PASS: Final[dict[str, tuple[float, float]]] = dict.fromkeys(LEVELS[:5], (0.75, 0.6)) | {
    "C2": (0.80, 0.70)
}
#: from B1 production needs a certifying rater as well as the automatic scorer
SECOND_RATER_FROM: Final = "B1"
PRODUCTION_KINDS: Final = ("writing", "speaking")

#: docs/12 §4.3, verbatim
FRAGILE_MESSAGE: Final = (
    "You passed the test, but a lot of this is still fragile. "
    "Let's consolidate for two weeks and then certify."
)

ConditionName = Literal["coverage", "retention", "exam", "production"]


@dataclass(frozen=True, slots=True)
class ExamResult:
    #: paper → share of its items answered right (listening, reading, use_of_english …)
    papers: Mapping[str, float]

    @property
    def overall(self) -> float:
        return sum(self.papers.values()) / len(self.papers) if self.papers else 0.0


def exam_passed(level: str, exam: ExamResult) -> tuple[bool, float, float]:
    """(passed, overall, lowest paper) under docs/12 §4.3."""
    overall_min, paper_min = EXAM_PASS[level]
    lowest = min(exam.papers.values(), default=0.0)
    return (
        bool(exam.papers) and exam.overall >= overall_min and lowest >= paper_min,
        exam.overall,
        lowest,
    )


@dataclass(frozen=True, slots=True)
class Production:
    """One productive skill's best bands: the automatic scorer's and a certifying rater's."""

    automatic: float | None = None
    certified: float | None = None


@dataclass(frozen=True, slots=True)
class LevelEvidence:
    level: str
    syllabus_total: int
    syllabus_passed: int
    memory_total: int
    memory_retained: int
    exam: ExamResult | None = None
    production: Mapping[str, Production] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Condition:
    name: ConditionName
    passed: bool
    value: float | None
    threshold: float
    #: plain words on what is short and by how much ("" when passed)
    shortfall: str


@dataclass(frozen=True, slots=True)
class LevelAwardResult:
    level: str
    awarded: bool
    conditions: tuple[Condition, ...]
    message: str | None
    remediation: tuple[str, ...]

    def condition(self, name: ConditionName) -> Condition:
        return next(c for c in self.conditions if c.name == name)


def _share(part: int, whole: int) -> float:
    return part / whole if whole else 0.0


def evaluate_level_award(evidence: LevelEvidence) -> LevelAwardResult:
    level = evidence.level[:2]
    if level not in LEVELS:
        raise ValueError(f"unknown level {evidence.level!r}")

    coverage = _share(evidence.syllabus_passed, evidence.syllabus_total)
    short_items = max(
        0, math.ceil(COVERAGE_MIN * evidence.syllabus_total) - evidence.syllabus_passed
    )
    c_cov = Condition(
        "coverage",
        evidence.syllabus_total > 0 and coverage >= COVERAGE_MIN,
        round(coverage, 4),
        COVERAGE_MIN,
        (
            ""
            if short_items == 0 and evidence.syllabus_total
            else f"{short_items} more syllabus items to pass at tier 2"
        ),
    )

    retention = _share(evidence.memory_retained, evidence.memory_total)
    short_mem = max(0, math.ceil(RETENTION_MIN * evidence.memory_total) - evidence.memory_retained)
    c_ret = Condition(
        "retention",
        evidence.memory_total > 0 and retention >= RETENTION_MIN,
        round(retention, 4),
        RETENTION_MIN,
        (
            ""
            if short_mem == 0 and evidence.memory_total
            else f"{short_mem} more memory items to reach 'known' (21 days)"
        ),
    )

    overall_min, paper_min = EXAM_PASS[level]
    if evidence.exam is None or not evidence.exam.papers:
        c_exam = Condition("exam", False, None, overall_min, "the level exam has not been taken")
    else:
        ok, overall, _ = exam_passed(level, evidence.exam)
        weak = sorted(p for p, v in evidence.exam.papers.items() if v < paper_min)
        detail = ""
        if not ok:
            parts = []
            if overall < overall_min:
                parts.append(f"overall {overall:.0%} of {overall_min:.0%}")
            if weak:
                parts.append(f"{', '.join(weak)} below {paper_min:.0%}")
            detail = "; ".join(parts)
        c_exam = Condition("exam", ok, round(overall, 4), overall_min, detail)

    band = LEVEL_BAND[level]
    need_second = LEVELS.index(level) >= LEVELS.index(SECOND_RATER_FROM)
    gaps: list[str] = []
    lowest_band: float | None = None
    for kind in PRODUCTION_KINDS:
        p = evidence.production.get(kind, Production())
        if p.automatic is None:
            gaps.append(f"{kind}: no scored task yet")
        elif p.automatic < band:
            gaps.append(f"{kind}: band {p.automatic:g} of {band:g}")
        if need_second:
            if p.certified is None:
                gaps.append(f"{kind}: needs a certifying rater")
            elif p.certified < band:
                gaps.append(f"{kind}: rated band {p.certified:g} of {band:g}")
        for b in (p.automatic, p.certified if need_second else None):
            if b is not None:
                lowest_band = b if lowest_band is None else min(lowest_band, b)
    c_prod = Condition("production", not gaps, lowest_band, band, "; ".join(gaps))

    conditions = (c_cov, c_ret, c_exam, c_prod)
    awarded = all(c.passed for c in conditions)
    message = FRAGILE_MESSAGE if c_exam.passed and not c_ret.passed else None
    remediation = tuple(f"{c.name}: {c.shortfall}" for c in conditions if not c.passed)
    return LevelAwardResult(evidence.level, awarded, conditions, message, remediation)
