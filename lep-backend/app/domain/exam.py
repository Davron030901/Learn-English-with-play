"""Level exam blueprint (docs/12 §4.1–§4.2). Pure.

The receptive papers are auto-scored from the course's own items: there is no separate exam bank
yet (docs/12 §4.4 asks for 8× the exam length per level), so a form draws tier-3 then tier-2 items
of the level, never one the learner met in an exam in the last 12 months, chosen
deterministically from the exam's id. Writing tasks are authored here; speaking and mediation
tasks wait for speech scoring (Phase 8).
"""

from __future__ import annotations

import hashlib
from collections.abc import Collection, Iterable
from dataclasses import dataclass
from datetime import timedelta
from typing import Final

PAPERS: Final = ("listening", "reading", "use_of_english")

#: docs/12 §4.1: items per receptive paper
PAPER_ITEMS: Final[dict[str, dict[str, int]]] = {
    "A1": {"listening": 12, "reading": 15, "use_of_english": 15},
    "A2": {"listening": 16, "reading": 20, "use_of_english": 20},
    "B1": {"listening": 20, "reading": 25, "use_of_english": 25},
    "B2": {"listening": 25, "reading": 30, "use_of_english": 30},
    "C1": {"listening": 30, "reading": 35, "use_of_english": 35},
    "C2": {"listening": 35, "reading": 40, "use_of_english": 40},
}

#: which exercise types each paper is built from (docs/12 §4.2)
PAPER_TYPES: Final[dict[str, frozenset[str]]] = {
    "listening": frozenset(
        {"listen_gist_mcq", "listen_detail_gap", "listen_order_events", "dictation_sentence"}
    ),
    "reading": frozenset({"read_gist_mcq", "read_scan_detail"}),
    "use_of_english": frozenset(
        {
            "gap_fill_bank",
            "gap_fill_free",
            "error_correct",
            "grammaticality_judgement",
            "sentence_reorder",
            "word_bank_build",
            "mcq_word_from_definition",
            "pragmatics_choose",
        }
    ),
}

#: docs/12 §4.1: minutes per receptive paper (listening, reading, use of English)
PAPER_MINUTES: Final[dict[str, dict[str, int]]] = {
    "A1": {"listening": 15, "reading": 20, "use_of_english": 10},
    "A2": {"listening": 20, "reading": 25, "use_of_english": 15},
    "B1": {"listening": 25, "reading": 35, "use_of_english": 20},
    "B2": {"listening": 30, "reading": 45, "use_of_english": 30},
    "C1": {"listening": 35, "reading": 55, "use_of_english": 35},
    "C2": {"listening": 40, "reading": 60, "use_of_english": 40},
}
#: time to settle in and to sync answers after the last paper
EXAM_GRACE: Final = timedelta(minutes=10)

#: docs/12 §4.4: no item reused for the same learner within 12 months
REUSE_AFTER: Final = timedelta(days=365)
#: a paper needs at least this share of its blueprint to be a fair paper. 0.4, not 0.5: the
#: course's C1 reading pool is 14 items against a blueprint of 35 (there is no exam bank yet)
MIN_PAPER_FILL: Final = 0.4


def exam_duration(level: str) -> timedelta:
    return timedelta(minutes=sum(PAPER_MINUTES[level].values())) + EXAM_GRACE


@dataclass(frozen=True, slots=True)
class Candidate:
    item_id: str
    type_id: str
    tier: int


def _rank(*key: str) -> int:
    return int.from_bytes(hashlib.sha256("\x1f".join(key).encode()).digest()[:8], "big")


def paper_of(type_id: str) -> str | None:
    return next((p for p, types in PAPER_TYPES.items() if type_id in types), None)


def build_form(
    level: str, candidates: Iterable[Candidate], seen: Collection[str], seed: str
) -> dict[str, list[str]]:
    """Paper → item ids. Tier 3 first, then tier 2; varied types; nothing seen in 12 months."""
    pools: dict[str, list[Candidate]] = {p: [] for p in PAPERS}
    for c in candidates:
        paper = paper_of(c.type_id)
        if paper is not None and c.tier >= 2 and c.item_id not in seen:
            pools[paper].append(c)
    form: dict[str, list[str]] = {}
    for paper, pool in pools.items():
        want = PAPER_ITEMS[level][paper]
        ordered = sorted(pool, key=lambda c: (-c.tier, _rank(seed, paper, c.item_id)))
        # spread the types: round-robin over them in that order
        by_type: dict[str, list[str]] = {}
        for c in ordered:
            by_type.setdefault(c.type_id, []).append(c.item_id)
        picked: list[str] = []
        while len(picked) < want and any(by_type.values()):
            for ids in by_type.values():
                if ids and len(picked) < want:
                    picked.append(ids.pop(0))
        form[paper] = picked
    return form


def fair(level: str, form: dict[str, list[str]]) -> list[str]:
    """Papers too thin to be fair (fewer than half their blueprint items)."""
    return [p for p in PAPERS if len(form.get(p, [])) < MIN_PAPER_FILL * PAPER_ITEMS[level][p]]


@dataclass(frozen=True, slots=True)
class WritingTask:
    id: str
    level: str
    prompt: str
    min_words: int
    max_words: int


#: docs/05 §6 genres, one or two per level
WRITING_TASKS: Final[tuple[WritingTask, ...]] = (
    WritingTask(
        "w.A1.1",
        "A1",
        "Write to a new friend. Say your name, where you live, and what you like.",
        25,
        60,
    ),
    WritingTask(
        "w.A2.1",
        "A2",
        "Write a message to a friend about your last weekend. What did you do?",
        40,
        90,
    ),
    WritingTask(
        "w.B1.1",
        "B1",
        "Write an email to a hotel. You stayed there last week and lost something. "
        "Explain what happened and ask for help.",
        100,
        160,
    ),
    WritingTask(
        "w.B1.2",
        "B1",
        "Write a short article for a school website: 'A place in my city everyone should visit'.",
        100,
        160,
    ),
    WritingTask(
        "w.B2.1",
        "B2",
        "Some people say working from home is better than working in an office. "
        "Write an essay giving your opinion with reasons and examples.",
        180,
        260,
    ),
    WritingTask(
        "w.C1.1",
        "C1",
        "Write a report for your manager on how the company could reduce its energy use, "
        "with recommendations.",
        220,
        300,
    ),
    WritingTask(
        "w.C2.1",
        "C2",
        "Write a review essay assessing whether social media has done more to inform "
        "or to mislead the public. Weigh both sides and reach a conclusion.",
        280,
        360,
    ),
)


def writing_task(task_id: str) -> WritingTask | None:
    return next((t for t in WRITING_TASKS if t.id == task_id), None)


def word_count(text: str) -> int:
    return len(text.split())


@dataclass(frozen=True, slots=True)
class SpeakingTask:
    id: str
    level: str
    prompt: str
    seconds: int


#: docs/12 §4.2 part 2, the long turn: a monologue on a prompt, scored from audio
SPEAKING_TASKS: Final[tuple[SpeakingTask, ...]] = (
    SpeakingTask(
        "s.A1.1", "A1", "Tell me about yourself: your name, your family and your home.", 45
    ),
    SpeakingTask("s.A2.1", "A2", "Tell me about a day you enjoyed recently. What did you do?", 60),
    SpeakingTask("s.B1.1", "B1", "Describe a place you would like to visit and explain why.", 90),
    SpeakingTask(
        "s.B2.1",
        "B2",
        "Some say cities should ban cars from their centres. What do you think?",
        120,
    ),
    SpeakingTask(
        "s.C1.1", "C1", "How has technology changed the way people learn? Give examples.", 150
    ),
    SpeakingTask(
        "s.C2.1",
        "C2",
        "Is it ever right to break a rule in order to do the right thing? Argue your position.",
        180,
    ),
)


def speaking_task(task_id: str) -> SpeakingTask | None:
    return next((t for t in SPEAKING_TASKS if t.id == task_id), None)
