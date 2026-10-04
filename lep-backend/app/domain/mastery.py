"""Mastery states and the weakest-aspect rule (docs/08 §3, §4.1; backend brief §6.5).

Pure. A lexeme is several memory items — recognition, aural, recall, spelling, production —
and the learner "knows" the lexeme only as well as its *weakest* required aspect: the
minimum stability, never the maximum or the mean. That rule is what stops the app claiming
5,000 words a learner can only recognise.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Final


class MasteryState(StrEnum):
    UNSEEN = "unseen"
    LEARNING = "learning"
    YOUNG = "young"
    RETAINED = "retained"
    DURABLE = "durable"
    LEECH = "leech"
    SUSPENDED = "suspended"
    RETIRED = "retired"


#: docs/08 §4.1 thresholds, in days of stability.
YOUNG_FROM: Final = 1.0
RETAINED_FROM: Final = 21.0
DURABLE_FROM: Final = 180.0
RETIRED_FROM: Final = 365.0
RETIRED_MAX_DIFFICULTY: Final = 4.0
LEECH_MIN_REVIEWS: Final = 6
LEECH_MAX_STABILITY: Final = 5.0
LEECH_LAPSES_IN_30_DAYS: Final = 4

#: Learner-facing names (docs/08 §4.1).
LABELS: Final[dict[MasteryState, str]] = {
    MasteryState.UNSEEN: "",
    MasteryState.LEARNING: "Learning",
    MasteryState.YOUNG: "Getting there",
    MasteryState.RETAINED: "Known",
    MasteryState.DURABLE: "Strong",
    MasteryState.LEECH: "Needs a different approach",
    MasteryState.SUSPENDED: "Paused",
    MasteryState.RETIRED: "Mastered",
}

#: States that count as "known" for coverage and for the level award (docs/08 §4.2).
KNOWN_STATES: Final = frozenset({MasteryState.RETAINED, MasteryState.DURABLE, MasteryState.RETIRED})


@dataclass(frozen=True, slots=True)
class ItemHistory:
    """What classification needs to know about one memory item."""

    stability: float | None
    difficulty: float | None
    reviews: int
    lapses_last_30_days: int = 0
    suspended: bool = False


def classify(item: ItemHistory) -> MasteryState:
    """docs/08 §4.1, with suspension first and retirement before leech (DECISIONS R12)."""
    if item.suspended:
        return MasteryState.SUSPENDED
    if item.stability is None or item.reviews == 0:
        return MasteryState.UNSEEN
    s = item.stability
    # Precedence (DECISIONS R12): suspended > retired > leech > durable > retained > young.
    if (
        s >= RETIRED_FROM
        and item.difficulty is not None
        and item.difficulty <= RETIRED_MAX_DIFFICULTY
    ):
        return MasteryState.RETIRED
    if (
        item.reviews >= LEECH_MIN_REVIEWS and s < LEECH_MAX_STABILITY
    ) or item.lapses_last_30_days >= LEECH_LAPSES_IN_30_DAYS:
        return MasteryState.LEECH
    if s >= DURABLE_FROM:
        return MasteryState.DURABLE
    if s >= RETAINED_FROM:
        return MasteryState.RETAINED
    if s >= YOUNG_FROM:
        return MasteryState.YOUNG
    return MasteryState.LEARNING


# ------------------------------------------------------------------- lexeme aspects


class Aspect(StrEnum):
    """The memory-item kinds of a lexeme (docs/08 §3)."""

    RECOG = "recog"
    AURAL = "aural"
    RECALL = "recall"
    SPELL = "spell"
    PRODUCE = "prod"


#: docs/08 §3 progression: (aspect, prerequisite aspect, prerequisite stability in days).
#: ``recog`` and ``aural`` unlock together; ``recall`` after ``recog`` reaches S ≥ 7 d;
#: ``spell`` after ``recall`` S ≥ 7 d; ``produce`` after ``recall`` S ≥ 21 d.
UNLOCKS: Final[tuple[tuple[Aspect, Aspect | None, float], ...]] = (
    (Aspect.RECOG, None, 0.0),
    (Aspect.AURAL, None, 0.0),
    (Aspect.RECALL, Aspect.RECOG, 7.0),
    (Aspect.SPELL, Aspect.RECALL, 7.0),
    (Aspect.PRODUCE, Aspect.RECALL, 21.0),
)


def unlocked_aspects(stability_by_aspect: Mapping[Aspect, float | None]) -> frozenset[Aspect]:
    """Which aspects the scheduler may introduce now."""
    out: set[Aspect] = set()
    for aspect, prerequisite, threshold in UNLOCKS:
        if prerequisite is None:
            out.add(aspect)
            continue
        s = stability_by_aspect.get(prerequisite)
        if s is not None and s >= threshold:
            out.add(aspect)
    return frozenset(out)


def weakest_stability(
    stability_by_aspect: Mapping[Aspect, float | None],
    required: frozenset[Aspect] | None = None,
) -> float | None:
    """A lexeme's mastery: the **minimum** stability across its required aspects.

    ``required`` defaults to the aspects the content actually exercises for this lexeme
    (the keys present). An unseen required aspect means the lexeme is not known at all, so
    the result is None.
    """
    aspects = required if required is not None else frozenset(stability_by_aspect)
    if not aspects:
        return None
    values: list[float] = []
    for aspect in aspects:
        s = stability_by_aspect.get(aspect)
        if s is None:
            return None
        values.append(s)
    return min(values)


def lexeme_known(
    stability_by_aspect: Mapping[Aspect, float | None],
    required: frozenset[Aspect] | None = None,
) -> bool:
    """Counted in "words known": the weakest required aspect is at least retained."""
    s = weakest_stability(stability_by_aspect, required)
    return s is not None and s >= RETAINED_FROM
