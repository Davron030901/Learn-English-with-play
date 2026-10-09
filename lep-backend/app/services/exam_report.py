"""The report after a level exam (docs/12 §9.2): gathering the evidence for ``domain.exam_report``.

Everything in it is read from what the server already holds — the exam's form and the first
answer it received for each item inside the exam's window (the answers that were scored), the
rated writing and speaking of the level, the learner's memory state, and the units completed —
so the report can be asked for again at any time and says the same thing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.content.catalog import ContentCatalog
from app.domain import exam_report as rp
from app.domain.rubric import LEVEL_BAND
from app.models.certification import LevelExam
from app.models.gamification import UnitProgress
from app.models.review import ReviewAttempt
from app.services.certification import CertificationError, CertificationService, _uuid7_floor
from app.services.progress import ProgressService

LEVEL_KINDS: Final = ("writing", "speaking")


@dataclass(frozen=True, slots=True)
class TargetInfo:
    label: str
    unit_id: str
    rank: int


@dataclass(frozen=True, slots=True)
class Skill:
    skill: str
    #: listening, reading and language: share right; writing, speaking: the rubric band (1–6)
    value: float | None
    #: what the level asks for (the paper's overall bar, or the level's band)
    target: float
    scale: str


@dataclass(frozen=True, slots=True)
class Vocabulary:
    known_lexemes: int
    level_known: int
    level_total: int
    estimate_percent: float


@dataclass(frozen=True, slots=True)
class Fluency:
    reading_target_wpm: str
    speech_target_wpm: str
    #: measured once recorded speech is scored (R15); never estimated
    speech_rate_wpm: float | None


@dataclass(frozen=True, slots=True)
class ExamReport:
    exam: LevelExam
    overall: float
    papers: list[rp.PaperReport]
    skills: list[Skill]
    error_types: list[rp.ErrorType]
    work_on: list[tuple[rp.WorkOn, TargetInfo | None]]
    vocabulary: Vocabulary
    fluency: Fluency
    timeline: rp.Timeline


_TARGETS: dict[str, dict[str, TargetInfo]] = {}


def _targets(catalog: ContentCatalog) -> dict[str, TargetInfo]:
    """Every syllabus target's label and the first unit that teaches it, in course order;
    built once per content version."""
    hit = _TARGETS.get(catalog.version)
    if hit is not None:
        return hit
    out: dict[str, TargetInfo] = {}
    for rank, unit_id in enumerate(catalog.unit_order()):
        unit = catalog.units[unit_id]
        for lexeme_id in unit.lexeme_ids:
            lex = catalog.lexemes.get(lexeme_id)
            if lex is not None and lexeme_id not in out:
                out[lexeme_id] = TargetInfo(lex.lemma, unit_id, rank)
        for group in (unit.grammar, unit.functions, unit.phonology):
            for point in group:
                pid = str(point.get("id", ""))
                if pid and pid not in out:
                    out[pid] = TargetInfo(str(point.get("label", pid)), unit_id, rank)
    _TARGETS[catalog.version] = out
    return out


async def exam_report(
    session: AsyncSession, catalog: ContentCatalog, clock: Clock, learner_id: UUID, exam_id: UUID
) -> ExamReport:
    row = await session.get(LevelExam, (learner_id, exam_id))
    if row is None:
        raise CertificationError("not_found", "there is no such exam")
    if row.completed_at is None or row.scores is None:
        raise CertificationError("incomplete", "finish the exam first; the report follows it")
    level = row.level
    now = clock.now()

    # the first answer received for each item inside the exam's window: the scored answers
    paper_of = {i: paper for paper, items in row.papers.items() for i in items}
    rows = await session.execute(
        select(ReviewAttempt.item_id, ReviewAttempt.verdict, ReviewAttempt.rt_ms)
        .where(
            ReviewAttempt.learner_id == learner_id,
            ReviewAttempt.session_id == exam_id,
            ReviewAttempt.item_id.in_(list(paper_of)),
            ReviewAttempt.id >= _uuid7_floor(row.created_at),
            ReviewAttempt.id < _uuid7_floor(row.ends_at),
        )
        .order_by(ReviewAttempt.id)
    )
    first: dict[str, rp.Answer] = {}
    for r in rows:
        item = catalog.items.get(r.item_id)
        if r.item_id in first or item is None:
            continue
        first[r.item_id] = rp.Answer(
            item_id=r.item_id,
            paper=paper_of[r.item_id],
            correct=r.verdict == "correct",
            rt_ms=int(r.rt_ms),
            memory_items=item.memory_items,
        )
    answers = list(first.values())
    papers = rp.papers(level, row.papers, answers)
    overall = sum(p.score for p in papers) / len(papers) if papers else 0.0

    automatic, _ = await CertificationService(session, catalog, clock)._production(
        learner_id, level
    )
    bar = papers[0].overall_bar if papers else 0.0
    by_paper = {p.paper: p.score for p in papers}
    skills = [
        Skill("listening", by_paper.get("listening"), bar, "share"),
        Skill("reading", by_paper.get("reading"), bar, "share"),
        Skill("language", by_paper.get("use_of_english"), bar, "share"),
        *(Skill(k, automatic.get(k), LEVEL_BAND[level], "band") for k in LEVEL_KINDS),
    ]

    targets = _targets(catalog)
    order = {t: info.rank for t, info in targets.items()}
    work = [(w, targets.get(w.target)) for w in rp.work_on(answers, order)]

    progress = ProgressService(session, catalog)
    lexemes = await progress.lexemes(learner_id, now)
    known, _, percent = progress.coverage(lexemes)
    in_level = [lx for lx in catalog.lexemes.values() if lx.cefr[:2] == level]
    vocabulary = Vocabulary(
        known_lexemes=known,
        level_known=sum(1 for lx in in_level if lexemes.get(lx.id) and lexemes[lx.id].known),
        level_total=len(in_level),
        estimate_percent=percent,
    )

    done = {
        r.unit_id: r.completed_at
        for r in await session.execute(
            select(UnitProgress.unit_id, UnitProgress.completed_at).where(
                UnitProgress.learner_id == learner_id
            )
        )
    }
    recent = _recent(done, now)
    nxt = rp.NEXT_LEVEL.get(level)
    order_units = catalog.unit_order()
    if nxt is None:
        left = 0
    else:
        last = max(
            (k for k, u in enumerate(order_units) if catalog.units[u].cefr[:2] == nxt),
            default=len(order_units) - 1,
        )
        left = sum(1 for u in order_units[: last + 1] if u not in done)

    return ExamReport(
        exam=row,
        overall=round(overall, 4),
        papers=papers,
        skills=skills,
        error_types=rp.error_types(answers),
        work_on=work,
        vocabulary=vocabulary,
        fluency=Fluency(rp.READING_WPM[level], rp.SPEECH_WPM[level], None),
        timeline=rp.timeline(level, left, recent),
    )


def _recent(done: dict[str, datetime], now: datetime) -> int:
    since = now - timedelta(days=rp.PACE_WINDOW_DAYS)
    return sum(1 for at in done.values() if since <= at <= now)
