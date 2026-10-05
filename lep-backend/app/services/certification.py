"""Level exams, production scoring, appeals, audits and the level award (backend brief Phase 7).

* **Level exam** — the receptive papers (listening, reading, use of English) as a fixed form of
  the course's items (``app.domain.exam``). Answers come through the ordinary review sync with
  ``session_id`` = the exam id, as test-outs do; completing grades the first answer per item,
  and an unanswered item counts as wrong — it is an exam.
* **Production** — a writing task is rated once by the configured rater; every criterion keeps
  the learner's own sentences that anchored it (a quotation not in the text is dropped, and a
  criterion left with none fails validation). Whether a score may certify is decided from the
  rater's calibration at the time of scoring (κ ≥ 0.75 for that level and task kind).
* **Human audit** — every borderline certifying score, a deterministic 10 % of the others and
  every appeal are queued for a human rater.
* **Level award** — the four conditions (``app.domain.level_award``) from stored evidence; an
  award evaluation is stored with its whole evidence object.
* **Retention audit** — once a month, 20 known items presented cold; predicted vs actual recall.
  When the learner remembers materially less than predicted (more than 10 points), the desired
  retention steps up one preset and every due date is re-derived (docs/08 §9).
"""

from __future__ import annotations

import hashlib
import math
import re
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Any, Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.content.catalog import ContentCatalog
from app.domain import exam as ex
from app.domain.fsrs import RETENTION_PRESETS, retrievability
from app.domain.grading import FAMILY
from app.domain.level_award import (
    LEVELS,
    ExamResult,
    LevelAwardResult,
    LevelEvidence,
    Production,
    evaluate_level_award,
    exam_passed,
)
from app.domain.mastery import KNOWN_STATES, MasteryState
from app.domain.rubric import (
    Calibration,
    CriterionScore,
    Rated,
    is_borderline,
    may_certify,
)
from app.domain.scheduling import reschedule
from app.ids import uuid7
from app.models.certification import (
    Appeal,
    HumanAudit,
    LevelAward,
    LevelExam,
    ProductionSubmission,
    RaterCalibration,
    RetentionAudit,
    RubricScore,
)
from app.models.gamification import NodeProgress
from app.models.learner import LearnerSettings
from app.models.review import MemoryState, ReviewAttempt
from app.repositories.reviews import ReviewRepository
from app.services.progress import _indexes

AUDIT_SAMPLE_SHARE: Final = 0.10
RETENTION_AUDIT_ITEMS: Final = 20
RETENTION_AUDIT_MIN_ITEMS: Final = 5
RETENTION_AUDIT_EVERY: Final = timedelta(days=28)
#: "materially below predicted" (docs/08 §9: predicted 90 %, actual 74 %)
RETENTION_GAP: Final = 0.10
#: share of an audit's items that must be answered for it to count
AUDIT_COVERAGE: Final = 0.8
MIN_WRITING_WORDS: Final = 5
#: families a cold check may use, recall first (never speech: it is self-assessed)
AUDIT_FAMILIES: Final = ("text", "bank", "choice", "order", "pairs")


class CertificationError(Exception):
    def __init__(self, kind: str, detail: str) -> None:
        super().__init__(detail)
        self.kind = kind


@dataclass(frozen=True, slots=True)
class _LevelIndex:
    #: syllabus target → the nodes whose items teach it
    target_nodes: dict[str, frozenset[str]]
    memory_items: frozenset[str]
    candidates: tuple[ex.Candidate, ...]


_INDEX: dict[tuple[str, str], _LevelIndex] = {}


def level_index(catalog: ContentCatalog, level: str) -> _LevelIndex:
    key = (catalog.version, level)
    hit = _INDEX.get(key)
    if hit is not None:
        return hit
    nodes: dict[str, set[str]] = defaultdict(set)
    memory: set[str] = set()
    candidates: list[ex.Candidate] = []
    for item in catalog.items.values():
        if catalog.units[item.unit_id].cefr[:2] != level:
            continue
        for m in item.memory_items:
            if m.startswith("txt."):
                continue
            memory.add(m)
            nodes[m.rpartition(".")[0]].add(item.node_id)
        if FAMILY.get(item.type_id) not in (None, "speak"):
            candidates.append(ex.Candidate(item.id, item.type_id, item.tier))
    hit = _INDEX[key] = _LevelIndex(
        {k: frozenset(v) for k, v in nodes.items()}, frozenset(memory), tuple(candidates)
    )
    return hit


def _sample_for_audit(score_id: UUID) -> bool:
    digest = hashlib.sha256(f"audit:{score_id}".encode()).digest()
    return int.from_bytes(digest[:4], "big") / 2**32 < AUDIT_SAMPLE_SHARE


_SPACE = re.compile(r"\s+")


def _norm(s: str) -> str:
    return _SPACE.sub(" ", s).strip().lower()


def grounded(scores: list[CriterionScore], text: str) -> list[CriterionScore]:
    """Keep only evidence that is really in the learner's text (a rater may not invent it)."""
    body = _norm(text)
    return [
        CriterionScore(
            s.criterion, s.band, tuple(e for e in s.evidence if _norm(e) and _norm(e) in body)
        )
        for s in scores
    ]


class CertificationService:
    def __init__(self, session: AsyncSession, catalog: ContentCatalog, clock: Clock) -> None:
        self._session = session
        self._catalog = catalog
        self._clock = clock

    # ------------------------------------------------------------------- the exam

    async def start_exam(self, learner_id: UUID, level: str) -> LevelExam:
        if level not in LEVELS:
            raise CertificationError("not_found", "there is no such level")
        now = self._clock.now()
        recent = await self._session.execute(
            select(LevelExam.papers).where(
                LevelExam.learner_id == learner_id,
                LevelExam.created_at >= now - ex.REUSE_AFTER,
            )
        )
        seen = {i for (papers,) in recent for ids in papers.values() for i in ids}
        eid = uuid7()
        form = ex.build_form(level, level_index(self._catalog, level).candidates, seen, str(eid))
        thin = ex.fair(level, form)
        if thin:
            raise CertificationError(
                "no_form", f"not enough unseen items for a fair exam ({', '.join(thin)})"
            )
        row = LevelExam(
            learner_id=learner_id,
            id=eid,
            level=level,
            papers=form,
            created_at=now,
            completed_at=None,
            scores=None,
            passed=None,
        )
        self._session.add(row)
        await self._session.flush()
        return row

    async def complete_exam(self, learner_id: UUID, exam_id: UUID) -> LevelExam:
        row = await self._session.get(LevelExam, (learner_id, exam_id), with_for_update=True)
        if row is None:
            raise CertificationError("not_found", "there is no such exam")
        if row.completed_at is not None:
            return row
        ids = [i for papers in row.papers.values() for i in papers]
        rows = await self._session.execute(
            select(ReviewAttempt.item_id, ReviewAttempt.verdict)
            .where(
                ReviewAttempt.learner_id == learner_id,
                ReviewAttempt.session_id == exam_id,
                ReviewAttempt.item_id.in_(ids),
            )
            .order_by(ReviewAttempt.ts)
        )
        first: dict[str, str] = {}
        for r in rows:
            first.setdefault(r.item_id, r.verdict)
        scores = {
            paper: round(sum(first.get(i) == "correct" for i in items) / len(items), 4)
            for paper, items in row.papers.items()
            if items
        }
        row.scores = scores
        row.passed = exam_passed(row.level, ExamResult(scores))[0]
        row.completed_at = self._clock.now()
        return row

    # ------------------------------------------------------------------- production

    async def new_writing(self, learner_id: UUID, task_id: str, text: str) -> ProductionSubmission:
        task = ex.writing_task(task_id)
        if task is None:
            raise CertificationError("not_found", "there is no such writing task")
        settings = await self._session.get(LearnerSettings, learner_id)
        if settings is not None and settings.data_collection_paused:
            raise CertificationError("paused", "data collection is paused")
        if ex.word_count(text) < MIN_WRITING_WORDS:
            raise CertificationError("invalid", "write a few sentences first")
        row = ProductionSubmission(
            learner_id=learner_id,
            id=uuid7(),
            level=task.level,
            kind="writing",
            task_id=task.id,
            prompt=task.prompt,
            text=text.strip(),
            status="awaiting_rater",
            created_at=self._clock.now(),
        )
        self._session.add(row)
        await self._session.flush()
        return row

    async def calibrations(self) -> dict[tuple[str, str, str], Calibration]:
        rows = await self._session.execute(select(RaterCalibration))
        return {
            (c.rater_version, c.level, c.kind): Calibration(
                c.rater_version, c.level, c.kind, c.kappa, c.samples
            )
            for (c,) in rows
        }

    async def store_score(
        self,
        learner_id: UUID,
        submission_id: UUID,
        rated: Rated,
        *,
        rater_kind: str,
        rater_version: str,
        prompt_version: str | None,
    ) -> RubricScore:
        sub = await self._session.get(
            ProductionSubmission, (learner_id, submission_id), with_for_update=True
        )
        if sub is None:
            raise CertificationError("not_found", "there is no such submission")
        certifying = rater_kind == "human" or may_certify(
            await self.calibrations(), rater_version, sub.level, sub.kind
        )
        score = RubricScore(
            learner_id=learner_id,
            id=uuid7(),
            submission_id=submission_id,
            level=sub.level,
            kind=sub.kind,
            rater_kind=rater_kind,
            rater_version=rater_version,
            prompt_version=prompt_version,
            criteria={
                c.criterion: {"band": c.band, "evidence": list(c.evidence)} for c in rated.criteria
            },
            overall=rated.overall,
            certifying=certifying,
            borderline=is_borderline(rated.overall, sub.level),
            created_at=self._clock.now(),
        )
        self._session.add(score)
        sub.status = "scored"
        await self._session.flush()
        if certifying and rater_kind != "human":
            if score.borderline:
                await self._audit(learner_id, score.id, "borderline")
            elif _sample_for_audit(score.id):
                await self._audit(learner_id, score.id, "sample")
        return score

    async def existing_score(self, learner_id: UUID, submission_id: UUID) -> RubricScore | None:
        """A submission is rated once: the stored score is the answer to any later read."""
        rows = await self._session.execute(
            select(RubricScore)
            .where(RubricScore.learner_id == learner_id, RubricScore.submission_id == submission_id)
            .order_by(RubricScore.created_at)
            .limit(1)
        )
        return rows.scalar_one_or_none()

    async def _audit(self, learner_id: UUID, score_id: UUID, reason: str) -> None:
        exists = await self._session.execute(
            select(HumanAudit.id).where(
                HumanAudit.learner_id == learner_id,
                HumanAudit.score_id == score_id,
                HumanAudit.reason == reason,
            )
        )
        if exists.first() is None:
            self._session.add(
                HumanAudit(
                    learner_id=learner_id,
                    id=uuid7(),
                    score_id=score_id,
                    reason=reason,
                    status="queued",
                    created_at=self._clock.now(),
                )
            )
            await self._session.flush()

    async def appeal(self, learner_id: UUID, score_id: UUID, reason: str) -> Appeal:
        score = await self._session.get(RubricScore, (learner_id, score_id))
        if score is None:
            raise CertificationError("not_found", "there is no such score")
        done = await self._session.execute(
            select(Appeal.id).where(Appeal.learner_id == learner_id, Appeal.score_id == score_id)
        )
        if done.first() is not None:
            raise CertificationError("appealed", "a score may be appealed once")
        row = Appeal(
            learner_id=learner_id,
            id=uuid7(),
            score_id=score_id,
            reason=reason.strip()[:2000],
            status="queued",
            created_at=self._clock.now(),
        )
        self._session.add(row)
        await self._session.flush()
        # a human who does not see the machine score (docs/12 §6.2)
        await self._audit(learner_id, score_id, "appeal")
        return row

    # ------------------------------------------------------------------- the award

    async def evidence(self, learner_id: UUID, level: str) -> LevelEvidence:
        if level not in LEVELS:
            raise CertificationError("not_found", "there is no such level")
        ix = level_index(self._catalog, level)
        passed_nodes = {
            r.node_id
            for r in await self._session.execute(
                select(NodeProgress.node_id).where(
                    NodeProgress.learner_id == learner_id, NodeProgress.tier >= 2
                )
            )
        }
        syllabus_passed = sum(1 for nodes in ix.target_nodes.values() if nodes & passed_nodes)
        states = await self._session.execute(
            select(MemoryState.memory_item_id, MemoryState.state).where(
                MemoryState.learner_id == learner_id
            )
        )
        retained = sum(
            1
            for r in states
            if r.memory_item_id in ix.memory_items and MasteryState(r.state) in KNOWN_STATES
        )
        exam_row = (
            await self._session.execute(
                select(LevelExam)
                .where(
                    LevelExam.learner_id == learner_id,
                    LevelExam.level == level,
                    LevelExam.completed_at.is_not(None),
                )
                .order_by(LevelExam.completed_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        scores = await self._session.execute(
            select(RubricScore.kind, RubricScore.overall, RubricScore.certifying).where(
                RubricScore.learner_id == learner_id, RubricScore.level == level
            )
        )
        automatic: dict[str, float] = {}
        certified: dict[str, float] = {}
        for r in scores:
            automatic[r.kind] = max(automatic.get(r.kind, 0.0), r.overall)
            if r.certifying:
                certified[r.kind] = max(certified.get(r.kind, 0.0), r.overall)
        return LevelEvidence(
            level=level,
            syllabus_total=len(ix.target_nodes),
            syllabus_passed=syllabus_passed,
            memory_total=len(ix.memory_items),
            memory_retained=retained,
            exam=ExamResult(exam_row.scores) if exam_row and exam_row.scores else None,
            production={
                k: Production(automatic.get(k), certified.get(k)) for k in ("writing", "speaking")
            },
        )

    async def evaluate(self, learner_id: UUID, level: str, *, record: bool) -> LevelAwardResult:
        evidence = await self.evidence(learner_id, level)
        result = evaluate_level_award(evidence)
        if record:
            self._session.add(
                LevelAward(
                    learner_id=learner_id,
                    id=uuid7(),
                    level=level,
                    awarded=result.awarded,
                    evidence=_evidence_json(evidence, result),
                    evaluated_at=self._clock.now(),
                )
            )
            await self._session.flush()
        return result

    # ------------------------------------------------------------------- retention audit

    async def start_retention_audit(self, learner_id: UUID) -> RetentionAudit:
        now = self._clock.now()
        last = await self._session.execute(
            select(RetentionAudit.created_at)
            .where(RetentionAudit.learner_id == learner_id)
            .order_by(RetentionAudit.created_at.desc())
            .limit(1)
        )
        previous = last.scalar_one_or_none()
        if previous is not None and now - previous < RETENTION_AUDIT_EVERY:
            raise CertificationError("too_soon", "the retention check runs once a month")
        known = [
            m
            for (m,) in await self._session.execute(
                select(MemoryState).where(
                    MemoryState.learner_id == learner_id,
                    MemoryState.state.in_(("retained", "durable")),
                )
            )
        ]
        if len(known) < RETENTION_AUDIT_MIN_ITEMS:
            raise CertificationError("too_few", "there is not enough known material to check yet")
        aid = uuid7()
        known.sort(key=lambda m: hashlib.sha256(f"{aid}:{m.memory_item_id}".encode()).digest())
        items: list[str] = []
        memory: list[str] = []
        rs: list[float] = []
        for m in known:
            item_id = self._audit_item(m.memory_item_id, set(items))
            if item_id is None:
                continue
            items.append(item_id)
            memory.append(m.memory_item_id)
            rs.append(
                retrievability(
                    max((now - m.last_review).total_seconds() / 86_400, 0.0), m.stability
                )
            )
            if len(items) == RETENTION_AUDIT_ITEMS:
                break
        row = RetentionAudit(
            learner_id=learner_id,
            id=aid,
            item_ids=items,
            memory_item_ids=memory,
            predicted=round(sum(rs) / len(rs), 4),
            actual=None,
            created_at=now,
            completed_at=None,
        )
        self._session.add(row)
        await self._session.flush()
        return row

    def _audit_item(self, memory_item_id: str, used: set[str]) -> str | None:
        """An auto-graded exercise, recall before recognition: a cold check must be scorable."""
        ix = _indexes(self._catalog)
        ranked = sorted(
            (
                i
                for i in ix.items_for.get(memory_item_id, ())
                if i not in used
                and self._catalog.items[i].type_id not in ("write_sentence",)
                and FAMILY.get(self._catalog.items[i].type_id) in AUDIT_FAMILIES
            ),
            key=lambda i: (AUDIT_FAMILIES.index(FAMILY[self._catalog.items[i].type_id]), i),
        )
        return ranked[0] if ranked else None

    async def complete_retention_audit(
        self, learner_id: UUID, audit_id: UUID
    ) -> tuple[RetentionAudit, float | None]:
        """Returns the audit and the new desired retention when it had to be raised."""
        row = await self._session.get(RetentionAudit, (learner_id, audit_id), with_for_update=True)
        if row is None:
            raise CertificationError("not_found", "there is no such retention check")
        if row.completed_at is not None:
            return row, None
        answers = await self._session.execute(
            select(ReviewAttempt.item_id, ReviewAttempt.verdict)
            .where(
                ReviewAttempt.learner_id == learner_id,
                ReviewAttempt.session_id == audit_id,
                ReviewAttempt.item_id.in_(row.item_ids),
            )
            .order_by(ReviewAttempt.ts)
        )
        first: dict[str, str] = {}
        for a in answers:
            first.setdefault(a.item_id, a.verdict)
        graded = [v for v in first.values() if v != "ungraded"]
        if len(first) < math.ceil(AUDIT_COVERAGE * len(row.item_ids)) or not graded:
            raise CertificationError("incomplete", "answer the check's items first")
        row.actual = round(sum(v == "correct" for v in graded) / len(graded), 4)
        row.completed_at = self._clock.now()
        raised = None
        if row.predicted - row.actual > RETENTION_GAP:
            raised = await self._raise_retention(learner_id)
        return row, raised

    async def _raise_retention(self, learner_id: UUID) -> float | None:
        settings = await self._session.get(LearnerSettings, learner_id, with_for_update=True)
        if settings is None:
            return None
        current = float(settings.desired_retention)
        higher = sorted(v for v in RETENTION_PRESETS.values() if v > current + 1e-9)
        if not higher:
            return None
        value = higher[0]
        settings.desired_retention = Decimal(str(value))
        repo = ReviewRepository(self._session)
        ids = await repo.all_memory_item_ids(learner_id)
        for memory_item_id, stored in (await repo.states(learner_id, ids)).items():
            await repo.upsert_state(
                learner_id,
                memory_item_id,
                reschedule(
                    stored.item,
                    learner_id=str(learner_id),
                    memory_item_id=memory_item_id,
                    desired_retention=value,
                ),
            )
        return value


def _evidence_json(evidence: LevelEvidence, result: LevelAwardResult) -> dict[str, Any]:
    return {
        "level": evidence.level,
        "syllabus": {"total": evidence.syllabus_total, "passed": evidence.syllabus_passed},
        "memory": {"total": evidence.memory_total, "retained": evidence.memory_retained},
        "exam": dict(evidence.exam.papers) if evidence.exam else None,
        "production": {k: asdict(v) for k, v in evidence.production.items()},
        "conditions": [asdict(c) for c in result.conditions],
        "awarded": result.awarded,
        "message": result.message,
    }


# ------------------------------------------------------------------- bias audit

#: docs/12 §6.1: a group difference above this many bands triggers a model review
BIAS_ALERT_BANDS: Final = 0.3
#: groups smaller than this are too small to compare
BIAS_MIN_GROUP: Final = 20


def _age_band(birth_year: int, year: int) -> str:
    age = year - birth_year
    return "under_18" if age < 18 else "18_29" if age < 30 else "30_49" if age < 50 else "50_plus"


async def bias_audit(session: AsyncSession, now_year: int) -> list[dict[str, Any]]:
    """Mean machine band by L1 and age band, per level and task kind (docs/12 §6.1).

    Gender and accent group are not collected by this product, so they cannot be audited here;
    the alert says when a difference exceeds 0.3 bands. Whether an independent proficiency
    measure explains it is for the model review the alert starts.
    """
    from app.models.learner import Learner

    rows = await session.execute(
        select(
            RubricScore.level, RubricScore.kind, RubricScore.overall, Learner.l1, Learner.birth_year
        )
        .join(Learner, Learner.id == RubricScore.learner_id)
        .where(RubricScore.rater_kind != "human")
    )
    groups: dict[tuple[str, str, str, str], list[float]] = defaultdict(list)
    for r in rows:
        groups[(r.level, r.kind, "l1", r.l1)].append(r.overall)
        groups[(r.level, r.kind, "age", _age_band(r.birth_year, now_year))].append(r.overall)
    alerts: list[dict[str, Any]] = []
    by_dimension: dict[tuple[str, str, str], dict[str, float]] = defaultdict(dict)
    for (level, kind, dim, group), values in groups.items():
        if len(values) >= BIAS_MIN_GROUP:
            by_dimension[(level, kind, dim)][group] = sum(values) / len(values)
    for (level, kind, dim), means in sorted(by_dimension.items()):
        if len(means) < 2:
            continue
        gap = max(means.values()) - min(means.values())
        if gap > BIAS_ALERT_BANDS:
            alerts.append(
                {
                    "level": level,
                    "kind": kind,
                    "dimension": dim,
                    "gap": round(gap, 3),
                    "means": means,
                }
            )
    return alerts
