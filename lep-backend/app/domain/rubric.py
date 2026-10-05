"""Rubric scoring and rater quality (docs/12 §5–§6; backend brief §8.4). Pure.

* Writing has 5 criteria, speaking 6 (the CEFR qualitative parameters), mediation 4; each is
  banded 1–6 (A1–C2), half-steps allowed.
* **The overall band is the median of the criteria, not the mean**, and a single criterion two
  bands or more below the median caps the overall at one band above that criterion
  (docs/12 §5.4). Rich vocabulary does not carry unintelligible pronunciation to C1.
* **A number with no evidence is not a score**: every criterion carries the sentences that
  anchored its band, or validation fails.
* **Agreement gate**: a rater may certify only while its quadratic weighted κ against the human
  panel is ≥ 0.75 for that level and task type; otherwise its scores are formative only.
* **Borderline**: an overall band within 5 % of the band scale of a pass boundary is borderline
  and always goes to a human (docs/12 §6).
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final, Literal

TaskKind = Literal["writing", "speaking", "mediation"]

CRITERIA: Final[dict[str, tuple[str, ...]]] = {
    "writing": ("task_achievement", "coherence", "lexis", "grammar", "register"),
    "speaking": ("range", "accuracy", "fluency", "interaction", "coherence", "phonology"),
    "mediation": ("completeness", "accuracy", "appropriacy", "independence"),
}

#: the band a level's production must reach (docs/12 §5.1: band n = the nth CEFR level)
LEVEL_BAND: Final[dict[str, float]] = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}
BAND_MIN: Final = 1.0
BAND_MAX: Final = 6.0
KAPPA_TO_CERTIFY: Final = 0.75
#: "within 5 % of a boundary": 5 % of the 1–6 scale
BORDERLINE_WIDTH: Final = 0.05 * (BAND_MAX - BAND_MIN)
#: a human rating that differs by this much from the machine joins the calibration set
CALIBRATION_GAP: Final = 1.0


class RubricInvalid(ValueError):
    """A rubric score that cannot be used: a missing criterion, an off-scale band, no evidence."""


@dataclass(frozen=True, slots=True)
class CriterionScore:
    criterion: str
    band: float
    evidence: tuple[str, ...]


def half_step_floor(x: float) -> float:
    return math.floor(x * 2 + 1e-9) / 2


def validate(kind: str, scores: Sequence[CriterionScore]) -> None:
    expected = CRITERIA.get(kind)
    if expected is None:
        raise RubricInvalid(f"unknown task kind {kind!r}")
    names = [s.criterion for s in scores]
    if sorted(names) != sorted(expected):
        raise RubricInvalid(f"{kind} needs exactly the criteria {', '.join(expected)}")
    for s in scores:
        if not BAND_MIN <= s.band <= BAND_MAX or s.band * 2 != int(s.band * 2):
            raise RubricInvalid(f"{s.criterion}: band {s.band} is not a half-step from 1 to 6")
        if not s.evidence or not all(e.strip() for e in s.evidence):
            raise RubricInvalid(f"{s.criterion}: a band needs the sentences that anchored it")


def overall_band(bands: Sequence[float]) -> float:
    """Median of the criteria, capped at one band above any criterion ≥ 2 below the median."""
    if not bands:
        raise RubricInvalid("no criteria")
    median = half_step_floor(statistics.median(bands))
    lowest = min(bands)
    if median - lowest >= 2:
        return min(median, lowest + 1)
    return median


@dataclass(frozen=True, slots=True)
class Rated:
    kind: str
    criteria: tuple[CriterionScore, ...]
    overall: float


def rate(kind: str, scores: Sequence[CriterionScore]) -> Rated:
    validate(kind, scores)
    return Rated(kind, tuple(scores), overall_band([s.band for s in scores]))


def meets_level(overall: float, level: str) -> bool:
    return overall >= LEVEL_BAND[level[:2]]


def is_borderline(overall: float, level: str) -> bool:
    """Within 5 % of the scale of the level's pass band, either side."""
    return abs(overall - LEVEL_BAND[level[:2]]) <= BORDERLINE_WIDTH + 1e-9


# ------------------------------------------------------------------------- rater agreement


def quadratic_weighted_kappa(a: Sequence[float], b: Sequence[float]) -> float:
    """Cohen's κ with quadratic weights over the half-step band scale (1, 1.5, …, 6)."""
    if len(a) != len(b) or not a:
        raise ValueError("two equally long, non-empty rating lists are needed")
    cats = [BAND_MIN + k / 2 for k in range(int((BAND_MAX - BAND_MIN) * 2) + 1)]
    index = {c: i for i, c in enumerate(cats)}
    n = len(cats)
    observed = [[0.0] * n for _ in range(n)]
    for x, y in zip(a, b, strict=True):
        observed[index[half_step_floor(x)]][index[half_step_floor(y)]] += 1
    total = len(a)
    row = [sum(r) for r in observed]
    col = [sum(observed[i][j] for i in range(n)) for j in range(n)]
    num = den = 0.0
    for i in range(n):
        for j in range(n):
            w = ((i - j) ** 2) / ((n - 1) ** 2)
            num += w * observed[i][j]
            den += w * row[i] * col[j] / total
    return 1.0 if den == 0 else 1 - num / den


@dataclass(frozen=True, slots=True)
class Calibration:
    rater_version: str
    level: str
    kind: str
    kappa: float
    samples: int


def may_certify(
    calibrations: Mapping[tuple[str, str, str], Calibration], rater: str, level: str, kind: str
) -> bool:
    """Checked at call time: no calibration, or κ below 0.75, means formative feedback only."""
    c = calibrations.get((rater, level[:2], kind))
    return c is not None and c.kappa >= KAPPA_TO_CERTIFY
