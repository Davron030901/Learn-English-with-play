"""FSRS-6, the memory model (docs/08 §2, backend brief §6).

Pure: no I/O, no clock, no randomness. Everything a review needs — elapsed time, whether
the review falls on the same learner-local day as the previous one, the fuzz draw — is
passed in, so replaying a learner's review log reproduces their memory state exactly
(backend brief Phase 4).

Three components per memory item: difficulty ``D`` in [1, 10], stability ``S`` in days
(the interval at which recall probability has decayed to 90 %), and retrievability ``R``
in [0, 1]. Twenty-one parameters ``w[0]…w[20]``; ``w[20]`` is FSRS-6's trainable decay.

Two places follow the FSRS-6 reference implementation where docs/08 §2 is silent, both
recorded in DECISIONS.md:

* a same-day review graded Good or Easy never *lowers* stability (the reference clamps the
  short-term multiplier at 1 for those grades; the doc's formula alone would shrink a long
  stability on a correct same-day answer);
* stability is floored at ``STABILITY_MIN`` so ``S > 0`` holds for every parameter vector.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence
from dataclasses import dataclass
from enum import IntEnum
from typing import Final

#: The published FSRS-6 default parameter vector. Never hand-tuned (backend brief §6.1);
#: per-cohort and per-learner optimisation replace it with fitted vectors (docs/08 §2.9).
FSRS6_DEFAULT_WEIGHTS: Final[tuple[float, ...]] = (
    0.212,
    1.2931,
    2.3065,
    8.2956,
    6.4133,
    0.8334,
    3.0194,
    0.001,
    1.8722,
    0.1666,
    0.796,
    1.4835,
    0.0614,
    0.2629,
    1.6483,
    0.6014,
    1.8729,
    0.5425,
    0.0912,
    0.0658,
    0.1542,
)

#: Recorded on every review_log row, so a state can always be traced to the maths that made it.
SCHEDULER_VERSION: Final = "fsrs6-2026-10-02"

PARAMETER_COUNT: Final = 21
STABILITY_MIN: Final = 0.001
DIFFICULTY_MIN: Final = 1.0
DIFFICULTY_MAX: Final = 10.0
MAX_INTERVAL_DAYS: Final = 36_500

#: docs/08 §2.2: the three learner-facing presets, and the exam-scope override.
RETENTION_PRESETS: Final[dict[str, float]] = {"relaxed": 0.85, "balanced": 0.90, "thorough": 0.94}
DEFAULT_DESIRED_RETENTION: Final = 0.90
EXAM_DESIRED_RETENTION: Final = 0.95

#: docs/08 §2.3: Hard above 2.5 × the learner's median response time, Easy below 0.6 ×.
HARD_RT_RATIO: Final = 2.5
EASY_RT_RATIO: Final = 0.6

#: docs/08 §2.10: ±5 % fuzz, at least ±1 day, on intervals long enough to spread.
FUZZ_RATIO: Final = 0.05
FUZZ_MIN_INTERVAL_DAYS: Final = 3


class Grade(IntEnum):
    """docs/08 §2.3."""

    AGAIN = 1
    HARD = 2
    GOOD = 3
    EASY = 4


class InvalidWeights(ValueError):
    """A parameter vector that the model cannot use."""


@dataclass(frozen=True, slots=True)
class Weights:
    """A validated FSRS-6 parameter vector."""

    w: tuple[float, ...]

    def __post_init__(self) -> None:
        if len(self.w) != PARAMETER_COUNT:
            raise InvalidWeights(f"FSRS-6 needs {PARAMETER_COUNT} parameters, got {len(self.w)}")
        if not all(math.isfinite(x) for x in self.w):
            raise InvalidWeights("every parameter must be a finite number")
        if self.w[20] <= 0:
            raise InvalidWeights("the decay w[20] must be positive")
        if not 0.0 <= self.w[7] <= 1.0:
            raise InvalidWeights("the mean-reversion weight w[7] must lie in [0, 1]")
        if any(self.w[i] <= 0 for i in range(4)):
            raise InvalidWeights("the initial stabilities w[0..3] must be positive")

    @classmethod
    def of(cls, values: Sequence[float]) -> Weights:
        return cls(tuple(float(v) for v in values))

    @property
    def decay(self) -> float:
        return self.w[20]

    @property
    def factor(self) -> float:
        """``0.9^(-1/w₂₀) - 1``: chosen so that ``R(S, S) = 0.9`` exactly."""
        return float(0.9 ** (-1.0 / self.w[20]) - 1.0)


DEFAULT_WEIGHTS: Final = Weights(FSRS6_DEFAULT_WEIGHTS)


@dataclass(frozen=True, slots=True)
class MemoryState:
    """The DSR state of one memory item after its latest review."""

    stability: float
    difficulty: float


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


# ------------------------------------------------------------------- forgetting curve


def retrievability(
    elapsed_days: float, stability: float, weights: Weights = DEFAULT_WEIGHTS
) -> float:
    """docs/08 §2.1: ``R(t, S) = (1 + FACTOR · t / S)^(-w₂₀)``."""
    if elapsed_days <= 0:
        return 1.0
    s = max(stability, STABILITY_MIN)
    return float((1.0 + weights.factor * elapsed_days / s) ** (-weights.decay))


def interval_days(
    stability: float,
    desired_retention: float = DEFAULT_DESIRED_RETENTION,
    weights: Weights = DEFAULT_WEIGHTS,
) -> float:
    """docs/08 §2.2: the time after which ``R`` falls to ``desired_retention``."""
    if not 0.0 < desired_retention < 1.0:
        raise ValueError("desired retention must lie strictly between 0 and 1")
    s = max(stability, STABILITY_MIN)
    return float((s / weights.factor) * (desired_retention ** (-1.0 / weights.decay) - 1.0))


# ------------------------------------------------------------------- initial state


def initial_stability(grade: Grade, weights: Weights = DEFAULT_WEIGHTS) -> float:
    """docs/08 §2.4: ``S₀(G) = w_{G-1}``."""
    return max(weights.w[int(grade) - 1], STABILITY_MIN)


def initial_difficulty(grade: Grade, weights: Weights = DEFAULT_WEIGHTS) -> float:
    """docs/08 §2.4: ``D₀(G) = w₄ - e^{w₅·(G-1)} + 1``, clamped to [1, 10]."""
    w = weights.w
    raw = w[4] - math.exp(w[5] * (int(grade) - 1)) + 1.0
    return _clamp(raw, DIFFICULTY_MIN, DIFFICULTY_MAX)


# ------------------------------------------------------------------- updates


def next_difficulty(difficulty: float, grade: Grade, weights: Weights = DEFAULT_WEIGHTS) -> float:
    """docs/08 §2.5: linear damping, then mean reversion toward ``D₀(4)``."""
    w = weights.w
    delta = -w[6] * (int(grade) - 3)
    damped = difficulty + delta * (10.0 - difficulty) / 9.0
    reverted = w[7] * initial_difficulty(Grade.EASY, weights) + (1.0 - w[7]) * damped
    return _clamp(reverted, DIFFICULTY_MIN, DIFFICULTY_MAX)


def stability_after_success(
    stability: float,
    difficulty: float,
    r: float,
    grade: Grade,
    weights: Weights = DEFAULT_WEIGHTS,
) -> float:
    """docs/08 §2.6, for ``G ≥ 2``."""
    if grade == Grade.AGAIN:
        raise ValueError("a lapse uses stability_after_lapse")
    w = weights.w
    hard = w[15] if grade == Grade.HARD else 1.0
    easy = w[16] if grade == Grade.EASY else 1.0
    gain = (
        math.exp(w[8])
        * (11.0 - difficulty)
        * stability ** (-w[9])
        * (math.exp(w[10] * (1.0 - r)) - 1.0)
        * hard
        * easy
    )
    return max(float(stability * (1.0 + gain)), STABILITY_MIN)


def stability_after_lapse(
    stability: float,
    difficulty: float,
    r: float,
    weights: Weights = DEFAULT_WEIGHTS,
) -> float:
    """docs/08 §2.7: never above the stability before the lapse, never reset to zero."""
    w = weights.w
    raw = (
        w[11]
        * difficulty ** (-w[12])
        * ((stability + 1.0) ** w[13] - 1.0)
        * math.exp(w[14] * (1.0 - r))
    )
    return max(min(float(raw), stability), STABILITY_MIN)


def stability_same_day(stability: float, grade: Grade, weights: Weights = DEFAULT_WEIGHTS) -> float:
    """docs/08 §2.8: ``S · e^{w₁₇·(G - 3 + w₁₈)} · S^{-w₁₉}``.

    For Good and Easy the multiplier is floored at 1, as in the FSRS-6 reference: a correct
    answer on the same day must not make the item *less* stable.
    """
    w = weights.w
    multiplier = math.exp(w[17] * (int(grade) - 3 + w[18])) * stability ** (-w[19])
    if grade >= Grade.GOOD:
        multiplier = max(multiplier, 1.0)
    return max(float(stability * multiplier), STABILITY_MIN)


def review(
    state: MemoryState | None,
    grade: Grade,
    elapsed_days: float,
    *,
    same_day: bool = False,
    weights: Weights = DEFAULT_WEIGHTS,
) -> MemoryState:
    """Apply one graded review.

    ``state`` is None for the first review of the item. ``elapsed_days`` is the time since
    the previous review; ``same_day`` is True when both reviews fall on the same
    learner-local calendar day (the caller knows the learner's time zone, this module does
    not).
    """
    if state is None:
        return MemoryState(initial_stability(grade, weights), initial_difficulty(grade, weights))
    d_next = next_difficulty(state.difficulty, grade, weights)
    if same_day:
        return MemoryState(stability_same_day(state.stability, grade, weights), d_next)
    r = retrievability(elapsed_days, state.stability, weights)
    if grade == Grade.AGAIN:
        s_next = stability_after_lapse(state.stability, state.difficulty, r, weights)
    else:
        s_next = stability_after_success(state.stability, state.difficulty, r, grade, weights)
    return MemoryState(s_next, d_next)


# ------------------------------------------------------------------- scheduling


def fuzz_unit(*key: str) -> float:
    """A deterministic draw in [0, 1) from a key, e.g. (learner id, memory item, review count).

    Fuzz exists to stop items learned together from clumping forever (docs/08 §2.10); it
    does not need to be random, only spread — and a hash keeps replay byte-for-byte exact.
    """
    digest = hashlib.sha256("\x1f".join(key).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def fuzzed_interval(days: float, u: float) -> int:
    """Whole days, fuzzed by ±5 % (at least ±1 day) using the draw ``u`` in [0, 1)."""
    if not 0.0 <= u < 1.0:
        raise ValueError("u must lie in [0, 1)")
    base = max(1, round(days))
    if base < FUZZ_MIN_INTERVAL_DAYS:
        return min(base, MAX_INTERVAL_DAYS)
    spread = max(1, round(base * FUZZ_RATIO))
    offset = math.floor(u * (2 * spread + 1)) - spread
    return int(_clamp(base + offset, 1, MAX_INTERVAL_DAYS))


def next_interval(
    state: MemoryState,
    *,
    desired_retention: float = DEFAULT_DESIRED_RETENTION,
    fuzz: float | None = None,
    weights: Weights = DEFAULT_WEIGHTS,
) -> int:
    """Days until the item is next due. ``fuzz`` is a draw from ``fuzz_unit``; None = no fuzz."""
    raw = interval_days(state.stability, desired_retention, weights)
    if fuzz is None:
        return int(_clamp(max(1, round(raw)), 1, MAX_INTERVAL_DAYS))
    return fuzzed_interval(raw, fuzz)


# ------------------------------------------------------------------- grading a response


def grade_response(
    *,
    correct: bool,
    rt_ms: int | None = None,
    median_rt_ms: float | None = None,
    hints_used: int = 0,
    timed_out: bool = False,
    marked_too_easy: bool = False,
) -> Grade:
    """docs/08 §2.3. ``median_rt_ms`` is the learner's median for *this exercise type*
    (falling back to the population median for the type); raw times are never compared
    across types."""
    if timed_out or not correct:
        return Grade.AGAIN
    if hints_used > 0:
        return Grade.HARD
    if marked_too_easy:
        return Grade.EASY
    if rt_ms is not None and median_rt_ms is not None and median_rt_ms > 0:
        if rt_ms > HARD_RT_RATIO * median_rt_ms:
            return Grade.HARD
        if rt_ms < EASY_RT_RATIO * median_rt_ms:
            return Grade.EASY
    return Grade.GOOD
