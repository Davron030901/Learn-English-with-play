"""Pronunciation scoring policy (docs/02 §10; backend brief §10.2). Pure.

The acoustic work — forced alignment, GOP per phone, stress from F0/intensity/duration, an
independent ASR pass — belongs to a speech scorer behind a port. This module is the policy that
matters more than the algorithm:

* **One** headline number (0–100) and **at most two** specific, actionable notes — never a wall
  of red; plus the phone-level detail for whoever wants it.
* The same utterance is judged against a different bar at each level (word GOP, independent-ASR
  WER, stress accuracy).
* **Never fail a learner for accent.** Only the *substitution of a contrastive phoneme* (ship →
  sheep) counts against them; an accented realisation of the right phoneme (a trilled /r/ that is
  still /r/) is a pass.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

#: docs/02 §10.2: (word GOP pass, max independent-ASR WER, min stress accuracy)
THRESHOLDS: Final[dict[str, tuple[float, float, float]]] = {
    "A1": (40, 0.40, 0.60),
    "A2": (50, 0.30, 0.70),
    "B1": (60, 0.22, 0.80),
    "B2": (68, 0.15, 0.88),
    "C1": (75, 0.10, 0.92),
    "C2": (80, 0.07, 0.95),
}
#: docs/02 §10.1: contrastive phones weigh double in the word score
CONTRASTIVE_WEIGHT: Final = 2.0
MAX_NOTES: Final = 2


@dataclass(frozen=True, slots=True)
class Phone:
    expected: str
    #: what the aligner heard
    heard: str
    #: 0–100, the goodness of pronunciation of the expected phone
    gop: float
    #: the expected phone is contrastive in this word (ship/sheep, think/sink …)
    contrastive: bool = False
    #: the scorer judged ``heard`` to be a *different phoneme*, not an accented variant of it
    substituted: bool = False


@dataclass(frozen=True, slots=True)
class Word:
    text: str
    phones: tuple[Phone, ...]
    stress_expected: int | None = None
    stress_heard: int | None = None


@dataclass(frozen=True, slots=True)
class Measurement:
    """What the speech scorer measured for one utterance."""

    words: tuple[Word, ...]
    #: word error rate of an ASR pass with no prior on the expected text
    independent_wer: float
    transcript: str
    speech_rate_wpm: float | None = None
    pause_ratio: float | None = None


@dataclass(frozen=True, slots=True)
class Verdict:
    headline: int
    passed: bool
    notes: tuple[str, ...]
    word_scores: tuple[tuple[str, float], ...]
    stress_accuracy: float | None
    intelligibility: float


def word_score(word: Word, floor: float = 70.0) -> float:
    """Mean GOP weighted by salience. A phone the scorer recognised as the right phoneme — however
    accented — is raised to ``floor``, the level's pass bar, so accent alone can never fail a word;
    only a substituted contrastive phoneme keeps its low GOP."""
    total = weight = 0.0
    for p in word.phones:
        w = CONTRASTIVE_WEIGHT if p.contrastive else 1.0
        gop = p.gop if (p.substituted and p.contrastive) else max(p.gop, floor)
        total += w * gop
        weight += w
    return total / weight if weight else 0.0


def judge(m: Measurement, level: str, *, free: bool = False) -> Verdict:
    """``free``: free speech (no expected text). The scorer port says GOP means nothing there,
    so only intelligibility is judged and the headline is intelligibility alone."""
    gop_pass, max_wer, stress_min = THRESHOLDS[level[:2]]
    intelligibility = max(0.0, 1.0 - m.independent_wer)
    if free or not m.words:
        return Verdict(
            headline=round(intelligibility * 100),
            passed=m.independent_wer <= max_wer,
            notes=(),
            word_scores=(),
            stress_accuracy=None,
            intelligibility=round(intelligibility, 3),
        )
    scores = tuple((w.text, round(word_score(w, floor=gop_pass), 1)) for w in m.words)
    mean_word = sum(s for _, s in scores) / len(scores)
    stressed = [w for w in m.words if w.stress_expected is not None]
    stress_acc = (
        sum(w.stress_heard == w.stress_expected for w in stressed) / len(stressed)
        if stressed
        else None
    )
    # the bar is per word (docs/02 §10.2): one ship → sheep fails, it is not averaged away
    passed = (
        all(s >= gop_pass for _, s in scores)
        and m.independent_wer <= max_wer
        and (stress_acc is None or stress_acc >= stress_min)
    )
    headline = round(
        0.6 * mean_word
        + 0.3 * intelligibility * 100
        + 0.1 * (stress_acc if stress_acc is not None else 1.0) * 100
    )
    return Verdict(
        headline=max(0, min(100, headline)),
        passed=passed,
        notes=tuple(_notes(m)[:MAX_NOTES]),
        word_scores=scores,
        stress_accuracy=None if stress_acc is None else round(stress_acc, 3),
        intelligibility=round(intelligibility, 3),
    )


def _notes(m: Measurement) -> list[str]:
    """Specific and actionable, the most important first: contrasts, then stress."""
    notes: list[str] = []
    seen: set[tuple[str, str]] = set()
    for w in m.words:
        for p in w.phones:
            if p.contrastive and p.substituted and (p.expected, p.heard) not in seen:
                seen.add((p.expected, p.heard))
                notes.append(f"In '{w.text}', /{p.expected}/ sounded like /{p.heard}/.")
    notes.extend(
        f"Stress '{w.text}' on syllable {w.stress_expected + 1}."
        for w in m.words
        if w.stress_expected is not None and w.stress_heard not in (None, w.stress_expected)
    )
    return notes


def phonology_band(headline: int) -> float:
    """The speaking rubric's phonology criterion from the headline (1–6 in half steps)."""
    raw = 1 + 5 * max(0, min(100, headline)) / 100
    return max(1.0, min(6.0, round(raw * 2) / 2))


def summarise(words: Sequence[Word]) -> str:
    return " ".join(w.text for w in words)
