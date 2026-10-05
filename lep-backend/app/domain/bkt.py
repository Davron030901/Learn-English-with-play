"""Bayesian Knowledge Tracing per syllabus item — the knowledge-tracing baseline (docs/08 §6.1).

Pure. FSRS models *memory of an item*; BKT estimates *mastery of a skill* from the run of right
and wrong answers on it. Its four parameters are interpretable, and ``p(guess)`` comes from the
exercise type's chance level (a 4-option choice is 0.25; free typing about 0.02). BKT powers the
"ready for the exam" signal only; it never gates anything on its own (docs/08 §6.1: any gate must
be explainable, and the gates are the four conditions of the level award).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final

#: chance level per exercise family (docs/08 §6.1)
GUESS: Final[dict[str, float]] = {
    "choice": 0.25,
    "pairs": 0.10,
    "bins": 0.20,
    "bank": 0.05,
    "order": 0.05,
    "text": 0.02,
    "speak": 0.02,
}
READY_AT: Final = 0.95


@dataclass(frozen=True, slots=True)
class BktParams:
    p_init: float = 0.10
    p_learn: float = 0.15
    p_slip: float = 0.10

    def __post_init__(self) -> None:
        for name in ("p_init", "p_learn", "p_slip"):
            v = getattr(self, name)
            if not 0.0 <= v < 1.0:
                raise ValueError(f"{name} must be in [0, 1)")


DEFAULT_PARAMS: Final = BktParams()


def update(p_known: float, correct: bool, family: str, params: BktParams = DEFAULT_PARAMS) -> float:
    """One answer: the posterior that the skill was known, then the chance it was learnt now."""
    guess = GUESS.get(family, 0.25)
    slip = params.p_slip
    if correct:
        evidence = p_known * (1 - slip)
        posterior = evidence / (evidence + (1 - p_known) * guess)
    else:
        evidence = p_known * slip
        posterior = evidence / (evidence + (1 - p_known) * (1 - guess))
    return posterior + (1 - posterior) * params.p_learn


def trace(answers: Iterable[tuple[bool, str]], params: BktParams = DEFAULT_PARAMS) -> float:
    """p(known) after a sequence of (correct, family) answers on one syllabus item."""
    p = params.p_init
    for correct, family in answers:
        p = update(p, correct, family, params)
    return p


def ready(p_known: float) -> bool:
    return p_known >= READY_AT
