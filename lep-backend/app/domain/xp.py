"""XP — effort on scheduled work, not taps (docs/10 §3, backend brief §9.1). Pure.

    XP(item) = base(type) × difficulty_mult × novelty_mult × mode_mult × accuracy_mult

* ``base``: recognition 1 · recall 2 · production 3 · speaking 4; writing 6 per 50 words,
  extensive reading 10 per 1,000 words, extensive listening 10 per 10 minutes — so immersion is
  worth more than tapping through an easy lesson, because it is worth more to the learner.
* ``difficulty_mult``: 0.5 when the predicted p(correct) > 0.95, 1.5 when < 0.7.
* ``novelty_mult``: **0.25 for re-grinding already-mastered content** — the load-bearing factor
  that removes the incentive to farm XP on easy old lessons. Do not simplify it away.
* ``mode_mult``: 1.25 for a timed session, 1.25 for a no-hints session (both: 1.5625).
* ``accuracy_mult`` (this build's reading of "effort", DECISIONS.md): a wrong answer is still
  effort and earns half; a timeout is not an attempt and earns nothing; free responses that are
  not graded earn in full.

Rounded once per session, never per item, so fractions are not lost.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum
from typing import Final


class Effort(StrEnum):
    RECOGNITION = "recognition"
    RECALL = "recall"
    PRODUCTION = "production"
    SPEAKING = "speaking"


BASE: Final[dict[Effort, float]] = {
    Effort.RECOGNITION: 1.0,
    Effort.RECALL: 2.0,
    Effort.PRODUCTION: 3.0,
    Effort.SPEAKING: 4.0,
}

#: The kind of effort each of the 31 exercise types asks for.
TYPE_EFFORT: Final[dict[str, Effort]] = {
    # recognition: choose, match, sort
    "tap_pairs": Effort.RECOGNITION,
    "memory_match": Effort.RECOGNITION,
    "word_race": Effort.RECOGNITION,
    "mcq_word_from_definition": Effort.RECOGNITION,
    "odd_one_out": Effort.RECOGNITION,
    "sort_bins": Effort.RECOGNITION,
    "stress_tap": Effort.RECOGNITION,
    "phoneme_id": Effort.RECOGNITION,
    "minimal_pair_discrimination": Effort.RECOGNITION,
    "grammaticality_judgement": Effort.RECOGNITION,
    "pragmatics_choose": Effort.RECOGNITION,
    "gap_fill_bank": Effort.RECOGNITION,
    "read_gist_mcq": Effort.RECOGNITION,
    "read_scan_detail": Effort.RECOGNITION,
    "listen_gist_mcq": Effort.RECOGNITION,
    "listen_detail_gap": Effort.RECOGNITION,
    "listen_order_events": Effort.RECOGNITION,
    # recall: produce the form from memory
    "type_from_l1": Effort.RECALL,
    "gap_fill_free": Effort.RECALL,
    "word_bank_build": Effort.RECALL,
    "sentence_reorder": Effort.RECALL,
    "dictation_word": Effort.RECALL,
    "dictation_sentence": Effort.RECALL,
    "spelling_bee": Effort.RECALL,
    "error_correct": Effort.RECALL,
    # production
    "write_sentence": Effort.PRODUCTION,
    # speaking
    "repeat_after": Effort.SPEAKING,
    "read_aloud": Effort.SPEAKING,
    "speak_prompt": Effort.SPEAKING,
    "speak_roleplay": Effort.SPEAKING,
    "speak_retell": Effort.SPEAKING,
}

EASY_P: Final = 0.95
HARD_P: Final = 0.7
NOVELTY_SCHEDULED: Final = 1.0
NOVELTY_REGRIND: Final = 0.25
MODE_BONUS: Final = 1.25
INCORRECT_SHARE: Final = 0.5

WRITING_XP_PER_50_WORDS: Final = 6.0
READING_XP_PER_1000_WORDS: Final = 10.0
LISTENING_XP_PER_10_MIN: Final = 10.0


class Outcome(StrEnum):
    CORRECT = "correct"
    INCORRECT = "incorrect"
    UNGRADED = "ungraded"
    TIMEOUT = "timeout"


@dataclass(frozen=True, slots=True)
class ItemEffort:
    type_id: str
    outcome: Outcome
    #: predicted p(correct) before the answer; None when unknown (cold start)
    p_correct: float | None = None
    #: the item belongs to content the learner has already mastered (replaying for its own sake)
    regrind: bool = False


@dataclass(frozen=True, slots=True)
class SessionMode:
    timed: bool = False
    no_hints: bool = False


DEFAULT_MODE: Final = SessionMode()


def difficulty_mult(p_correct: float | None) -> float:
    if p_correct is None:
        return 1.0
    if p_correct > EASY_P:
        return 0.5
    if p_correct < HARD_P:
        return 1.5
    return 1.0


def mode_mult(mode: SessionMode) -> float:
    return (MODE_BONUS if mode.timed else 1.0) * (MODE_BONUS if mode.no_hints else 1.0)


def accuracy_mult(outcome: Outcome) -> float:
    if outcome is Outcome.TIMEOUT:
        return 0.0
    if outcome is Outcome.INCORRECT:
        return INCORRECT_SHARE
    return 1.0


def item_xp(item: ItemEffort, mode: SessionMode = DEFAULT_MODE) -> float:
    """Unrounded XP for one answered item."""
    effort = TYPE_EFFORT.get(item.type_id)
    if effort is None:
        raise ValueError(f"no effort class for {item.type_id}")
    novelty = NOVELTY_REGRIND if item.regrind else NOVELTY_SCHEDULED
    return (
        BASE[effort]
        * difficulty_mult(item.p_correct)
        * novelty
        * mode_mult(mode)
        * accuracy_mult(item.outcome)
    )


def session_xp(items: Iterable[ItemEffort], mode: SessionMode = DEFAULT_MODE) -> int:
    """XP for a session, rounded once (half up)."""
    return math.floor(sum(item_xp(i, mode) for i in items) + 0.5)


def writing_xp(words: int) -> float:
    return WRITING_XP_PER_50_WORDS * max(words, 0) / 50


def reading_xp(words: int) -> float:
    """Extensive reading: 10 XP per 1,000 words read."""
    return READING_XP_PER_1000_WORDS * max(words, 0) / 1000


def listening_xp(seconds: int) -> float:
    """Extensive listening: 10 XP per 10 minutes."""
    return LISTENING_XP_PER_10_MIN * max(seconds, 0) / 600
