"""The report after a level exam (docs/12 §9.2) — and what it never shows (§9.3). Pure.

§9.2 asks for per-paper scores with band descriptors, the four-skills profile, error types
against level norms, vocabulary size and coverage, fluency against level targets, the top five
things to work on and an estimated timeline to the next level at the learner's own pace.

§9.3 forbids comparison with other learners, a single score without explanation, a predicted
external band presented as a promise, and any number the evidence does not support. So:

* every paper score comes with its bar and a band word, and the overall with the papers;
* a skill not yet assessed (writing or speaking with no rated task of the level) is ``None``,
  never zero and never guessed;
* there are no level norms for error types yet (no population data): the report gives the
  learner's own counts and says the norms are not available, instead of inventing them;
* fluency is what was measured — seconds per answer on each paper — beside the level's targets
  from docs/06; a speech rate is ``None`` until recorded speech is scored (R15);
* the timeline is units left at the pace of the last four weeks, or ``None`` with the reason
  when there is no pace to speak of.
"""

from __future__ import annotations

import math
import statistics
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Final, Literal

from app.domain.level_award import EXAM_PASS

Band = Literal["secure", "pass", "borderline", "below"]
Kind = Literal["vocabulary", "grammar", "function", "pronunciation", "comprehension"]

#: a paper this far above the overall bar is "secure"
SECURE_MARGIN: Final = 0.10
TOP_WORK_ON: Final = 5
PACE_WINDOW_DAYS: Final = 28

#: docs/06 §1.2 and §1.3 at the top of each level (a level exam certifies the whole level)
READING_WPM: Final[dict[str, str]] = {
    "A1": "55–75",
    "A2": "85–105",
    "B1": "120–145",
    "B2": "155–180",
    "C1": "180–210",
    "C2": "200–250",
}
SPEECH_WPM: Final[dict[str, str]] = {
    "A1": "50–65",
    "A2": "70–90",
    "B1": "95–115",
    "B2": "120–140",
    "C1": "135–155",
    "C2": "150–180",
}

NEXT_LEVEL: Final[dict[str, str | None]] = {
    "A1": "A2",
    "A2": "B1",
    "B1": "B2",
    "B2": "C1",
    "C1": "C2",
    "C2": None,
}


def kind_of(memory_item_id: str) -> Kind | None:
    """What a memory item is about, from the build's id convention."""
    if memory_item_id.startswith("lex."):
        return "vocabulary"
    if memory_item_id.startswith("G-"):
        return "grammar"
    if memory_item_id.startswith("F-"):
        return "function"
    if memory_item_id.startswith("P-"):
        return "pronunciation"
    if memory_item_id.startswith("txt."):
        return "comprehension"
    return None


def target_of(memory_item_id: str) -> str:
    """The syllabus target: the memory item without its aspect (``G-075.form`` → ``G-075``)."""
    return memory_item_id.rpartition(".")[0] or memory_item_id


def band(score: float, level: str) -> Band:
    overall, paper = EXAM_PASS[level]
    if score >= overall + SECURE_MARGIN:
        return "secure"
    if score >= overall:
        return "pass"
    if score >= paper:
        return "borderline"
    return "below"


@dataclass(frozen=True, slots=True)
class Answer:
    item_id: str
    paper: str
    correct: bool
    rt_ms: int
    memory_items: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PaperReport:
    paper: str
    score: float
    asked: int
    answered: int
    correct: int
    #: the paper's own bar and the overall bar (docs/12 §4.3)
    paper_bar: float
    overall_bar: float
    band: Band
    median_seconds: float | None


@dataclass(frozen=True, slots=True)
class ErrorType:
    kind: Kind
    asked: int
    wrong: int


@dataclass(frozen=True, slots=True)
class WorkOn:
    target: str
    kind: Kind
    wrong: int
    asked: int


@dataclass(frozen=True, slots=True)
class Timeline:
    next_level: str | None
    units_left: int
    units_per_week: float | None
    weeks: int | None
    #: why there is no estimate: "top_level", "no_pace", or "" when there is one
    reason: str


def papers(
    level: str, asked: Mapping[str, Sequence[str]], answers: Iterable[Answer]
) -> list[PaperReport]:
    overall_bar, paper_bar = EXAM_PASS[level]
    by_paper: dict[str, list[Answer]] = defaultdict(list)
    for a in answers:
        by_paper[a.paper].append(a)
    out = []
    for paper, items in asked.items():
        if not items:
            continue
        got = by_paper.get(paper, [])
        correct = sum(a.correct for a in got)
        score = correct / len(items)
        times = [a.rt_ms / 1000 for a in got]
        out.append(
            PaperReport(
                paper=paper,
                score=round(score, 4),
                asked=len(items),
                answered=len(got),
                correct=correct,
                paper_bar=paper_bar,
                overall_bar=overall_bar,
                band=band(score, level),
                median_seconds=round(statistics.median(times), 1) if times else None,
            )
        )
    return out


def error_types(answers: Iterable[Answer]) -> list[ErrorType]:
    """Per kind of target, how many asked and how many answered wrong (an item counts once per
    kind it practises). Unanswered items are not errors: they are reported per paper."""
    asked: Counter[str] = Counter()
    wrong: Counter[str] = Counter()
    for a in answers:
        kinds = {k for m in a.memory_items if (k := kind_of(m)) is not None}
        for k in kinds:
            asked[k] += 1
            if not a.correct:
                wrong[k] += 1
    order: tuple[Kind, ...] = (
        "vocabulary",
        "grammar",
        "function",
        "pronunciation",
        "comprehension",
    )
    return [ErrorType(k, asked[k], wrong[k]) for k in order if asked[k]]


def work_on(answers: Iterable[Answer], order: Mapping[str, int]) -> list[WorkOn]:
    """The targets most often wrong, at most five: the most wrong first, then those wrong on a
    larger share, then the earliest in the syllabus (``order``: target → rank)."""
    asked: Counter[str] = Counter()
    wrong: Counter[str] = Counter()
    kinds: dict[str, Kind] = {}
    for a in answers:
        for m in a.memory_items:
            k = kind_of(m)
            if k is None or k == "comprehension":
                continue
            t = target_of(m)
            kinds[t] = k
            asked[t] += 1
            if not a.correct:
                wrong[t] += 1
    ranked = sorted(
        (t for t in wrong if wrong[t]),
        key=lambda t: (-wrong[t], -wrong[t] / asked[t], order.get(t, 10**9), t),
    )
    return [WorkOn(t, kinds[t], wrong[t], asked[t]) for t in ranked[:TOP_WORK_ON]]


def timeline(level: str, units_left: int, units_done_recently: int) -> Timeline:
    nxt = NEXT_LEVEL.get(level)
    if nxt is None:
        return Timeline(None, 0, None, None, "top_level")
    pace = units_done_recently / (PACE_WINDOW_DAYS / 7)
    if units_left == 0:
        return Timeline(nxt, 0, round(pace, 2) if pace else None, 0, "")
    if pace <= 0:
        return Timeline(nxt, units_left, None, None, "no_pace")
    return Timeline(nxt, units_left, round(pace, 2), math.ceil(units_left / pace), "")


__all__ = [
    "NEXT_LEVEL",
    "PACE_WINDOW_DAYS",
    "READING_WPM",
    "SPEECH_WPM",
    "Answer",
    "Band",
    "ErrorType",
    "Kind",
    "PaperReport",
    "Timeline",
    "WorkOn",
    "band",
    "error_types",
    "kind_of",
    "papers",
    "target_of",
    "timeline",
    "work_on",
]
