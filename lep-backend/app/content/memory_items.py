"""Memory items — the unit the scheduler remembers (docs/08 §3, backend brief §3).

Storage follows the **build's** convention, not docs/08's, because learner records must match
the real data (backend brief §3.3): ``{syllabus_id}.{aspect}`` with no family prefix —
``lex.03421.recall``, ``G-107.form``, ``P-014.disc``, ``F-023.ex01``, ``txt.00004.comp``.

The packed bundle the app ships drops each item's ``memory_items`` list, so it is derived here
from the exercise type and the item's targets. The derivation reproduces the build exactly:
48,684 references to 11,791 distinct memory items over the 37,173 items, with the per-aspect
counts of brief §3.1 (checked in tests). An item with no targets is a story comprehension
question and exercises its unit's story (``txt.*.comp``).

docs/08 §3 also names four kinds the build never emits — collocation, transformation,
articulation and connected-speech decoding. Their aspects are reserved here (they parse) but
nothing produces them; DECISIONS.md flags them for the curriculum owner.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Final


class Family(StrEnum):
    LEXIS = "lex"
    GRAMMAR = "G"
    PHONOLOGY = "P"
    FUNCTION = "F"
    TEXT = "txt"


class Aspect(StrEnum):
    # emitted by the build
    RECOG = "recog"
    RECALL = "recall"
    AURAL = "aural"
    SPELL = "spell"
    PROD = "prod"
    FORM = "form"
    JUDGE = "judge"
    CHOICE = "choice"
    DISC = "disc"
    EX01 = "ex01"
    COMP = "comp"
    # docs/08 §3 kinds the build does not emit yet (reserved, parse only)
    COLL = "coll"
    TRANS = "trans"
    DECODE = "decode"


RESERVED_ASPECTS: Final = frozenset({Aspect.COLL, Aspect.TRANS, Aspect.DECODE})

#: The aspects each family can carry.
FAMILY_ASPECTS: Final[dict[Family, frozenset[Aspect]]] = {
    Family.LEXIS: frozenset(
        {Aspect.RECOG, Aspect.RECALL, Aspect.AURAL, Aspect.SPELL, Aspect.PROD, Aspect.COLL}
    ),
    Family.GRAMMAR: frozenset({Aspect.FORM, Aspect.JUDGE, Aspect.CHOICE, Aspect.TRANS}),
    Family.PHONOLOGY: frozenset({Aspect.DISC, Aspect.PROD}),
    Family.FUNCTION: frozenset({Aspect.EX01, Aspect.PROD}),
    Family.TEXT: frozenset({Aspect.COMP, Aspect.DECODE}),
}

_SYLLABUS_ID: Final[dict[Family, re.Pattern[str]]] = {
    Family.LEXIS: re.compile(r"lex\.\d{5}"),
    Family.GRAMMAR: re.compile(r"G-\d{3}"),
    Family.PHONOLOGY: re.compile(r"P-\d{3}"),
    Family.FUNCTION: re.compile(r"F-\d{3}"),
    Family.TEXT: re.compile(r"txt\.\d{5}"),
}


class InvalidMemoryItemId(ValueError):
    """Not ``{syllabus_id}.{aspect}`` with an aspect its family can carry."""


def family_of(syllabus_id: str) -> Family:
    for family, pattern in _SYLLABUS_ID.items():
        if pattern.fullmatch(syllabus_id):
            return family
    raise InvalidMemoryItemId(f"unknown syllabus id {syllabus_id!r}")


@dataclass(frozen=True, slots=True, order=True)
class MemoryItemId:
    syllabus_id: str
    aspect: Aspect

    def __post_init__(self) -> None:
        family = family_of(self.syllabus_id)
        if self.aspect not in FAMILY_ASPECTS[family]:
            raise InvalidMemoryItemId(f"{family.value} items have no {self.aspect.value} aspect")

    @classmethod
    def parse(cls, raw: str) -> MemoryItemId:
        syllabus_id, sep, aspect = raw.rpartition(".")
        if not sep or not syllabus_id:
            raise InvalidMemoryItemId(f"{raw!r} is not syllabus_id.aspect")
        try:
            parsed = Aspect(aspect)
        except ValueError:
            raise InvalidMemoryItemId(f"unknown aspect {aspect!r} in {raw!r}") from None
        return cls(syllabus_id, parsed)

    @property
    def family(self) -> Family:
        return family_of(self.syllabus_id)

    def __str__(self) -> str:
        return f"{self.syllabus_id}.{self.aspect.value}"


# ------------------------------------------------------------------- type → aspect (brief §3.2)

#: The aspect a lexis target gets from each exercise type.
LEXIS_ASPECT: Final[dict[str, Aspect]] = {
    "tap_pairs": Aspect.RECOG,
    "memory_match": Aspect.RECOG,
    "mcq_word_from_definition": Aspect.RECOG,
    "odd_one_out": Aspect.RECOG,
    "word_race": Aspect.RECOG,
    "stress_tap": Aspect.RECOG,
    "gap_fill_bank": Aspect.RECOG,
    "sort_bins": Aspect.RECOG,
    "type_from_l1": Aspect.RECALL,
    "gap_fill_free": Aspect.RECALL,
    "word_bank_build": Aspect.RECALL,
    "dictation_word": Aspect.AURAL,
    "dictation_sentence": Aspect.AURAL,
    "spelling_bee": Aspect.SPELL,
    "repeat_after": Aspect.PROD,
    "read_aloud": Aspect.PROD,
    "write_sentence": Aspect.PROD,
    "speak_prompt": Aspect.PROD,
}

#: The aspects a grammar target gets from each exercise type.
GRAMMAR_ASPECTS: Final[dict[str, tuple[Aspect, ...]]] = {
    "gap_fill_bank": (Aspect.FORM,),
    "dictation_sentence": (Aspect.FORM,),
    "sentence_reorder": (Aspect.FORM,),
    "write_sentence": (Aspect.FORM,),
    "error_correct": (Aspect.FORM, Aspect.JUDGE),
    "grammaticality_judgement": (Aspect.JUDGE,),
    "sort_bins": (Aspect.CHOICE,),
}

#: The aspect a function target gets from each exercise type.
FUNCTION_ASPECT: Final[dict[str, Aspect]] = {
    "pragmatics_choose": Aspect.EX01,
    "repeat_after": Aspect.PROD,
    "speak_prompt": Aspect.PROD,
    "speak_roleplay": Aspect.PROD,
}


class UnmappedTarget(ValueError):
    """An item targets a family its exercise type has no aspect for."""


def derive_memory_items(
    type_id: str, targets: Mapping[str, Sequence[str]], story_id: str
) -> tuple[str, ...]:
    """The memory items one answer to this item reviews — one review-log row each.

    Order follows the build (lexis, grammar, phonology, functions) and repeats are kept: a
    ``word_race`` over eleven pairs reviews eleven lexemes, a ``speak_roleplay`` with two
    functions reviews both.
    """
    out: list[str] = []
    for syllabus_id in targets.get("lexis", ()):
        aspect = LEXIS_ASPECT.get(type_id)
        if aspect is None:
            raise UnmappedTarget(f"{type_id} has no lexis aspect")
        out.append(f"{syllabus_id}.{aspect.value}")
    for syllabus_id in targets.get("grammar", ()):
        aspects = GRAMMAR_ASPECTS.get(type_id)
        if aspects is None:
            raise UnmappedTarget(f"{type_id} has no grammar aspect")
        out.extend(f"{syllabus_id}.{a.value}" for a in aspects)
    out.extend(f"{syllabus_id}.{Aspect.DISC.value}" for syllabus_id in targets.get("phonology", ()))
    for syllabus_id in targets.get("functions", ()):
        aspect = FUNCTION_ASPECT.get(type_id)
        if aspect is None:
            raise UnmappedTarget(f"{type_id} has no function aspect")
        out.append(f"{syllabus_id}.{aspect.value}")
    if not out:
        out.append(f"{story_id}.{Aspect.COMP.value}")
    return tuple(out)
