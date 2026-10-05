"""Review ingest — single answers and offline batches (backend brief Phase 4, Phase 9 §11).

For each record, in the order the learner answered:

1. **Idempotency.** A ``client_uuid`` seen before returns its first verdict; nothing is written
   again (``review_ingest_keys``).
2. **Grade on the server.** The item comes from the content catalog, the submission is graded
   by the same grader the app uses (``app.domain.grading``), the response time is clamped to
   [250 ms, 120 s] and turned into an FSRS grade (docs/08 §2.3). The device's verdict is stored
   for comparison and never trusted.
3. **Write the facts.** One ``review_attempts`` row, one ``review_log`` row per memory item the
   item exercises (backend brief §3.2). Free speech and free writing are stored as attempts
   but write no log rows: nothing graded them.
4. **Derive the state.** ``memory_state`` moves forward with ``apply_review``. A record older
   than an item's last review (a second device replaying late) makes that item re-derive from
   its whole log, so the stored state always equals a replay.

Batches are serialised per learner with an advisory lock, and each record is independent: one
bad record is rejected with its reason and the rest are accepted.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Final
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.content.catalog import ContentCatalog, ItemRecord
from app.domain.fsrs import SCHEDULER_VERSION, Grade, grade_response, retrievability
from app.domain.grading import FAMILY, GradeResult, InvalidSubmission, Verdict, grade
from app.domain.mastery import KNOWN_STATES
from app.domain.scheduling import LAPSE_WINDOW, ItemState, LoggedReview, apply_review, replay
from app.ids import Uuid7Sequence
from app.repositories.reviews import ReviewRepository

RT_MIN_MS: Final = 250
RT_MAX_MS: Final = 120_000
#: A device clock may run this far ahead of the server before the answer is re-timed.
CLOCK_ALLOWANCE: Final = timedelta(minutes=5)
MAX_BATCH: Final = 500

#: Population median response time per exercise family, until a learner has their own
#: (backend brief §6.2). Raw times are never compared across families.
POPULATION_MEDIAN_RT_MS: Final[dict[str, int]] = {
    "choice": 6_000,
    "text": 12_000,
    "bank": 15_000,
    "order": 20_000,
    "pairs": 30_000,
    "bins": 20_000,
    "speak": 10_000,
}
PAIRS_TYPES: Final = frozenset({"tap_pairs", "memory_match", "word_race"})


@dataclass(frozen=True, slots=True)
class IncomingReview:
    client_uuid: UUID
    created_at: datetime
    monotonic_ms: int
    item_id: str
    session_id: UUID | None
    submission: dict[str, Any]
    rt_ms: int
    hints_used: int
    plays_used: int
    content_version: str
    local_verdict: str | None


@dataclass(frozen=True, slots=True)
class IncomingDispute:
    client_uuid: UUID
    created_at: datetime
    review_client_uuid: UUID
    item_id: str


@dataclass(frozen=True, slots=True)
class Outcome:
    client_uuid: UUID
    #: "accepted", "duplicate" or "rejected"
    status: str
    verdict: str | None = None
    grade: int | None = None
    typo: tuple[str, str] | None = None
    #: the stable problem type when rejected
    problem: str | None = None
    #: the attempt as graded, for downstream accounting (XP, quests); None unless accepted now
    item: ItemRecord | None = None
    answered_at: datetime | None = None
    attempt_id: UUID | None = None
    session_id: UUID | None = None
    rt_ms: int = 0
    hints_used: int = 0
    timed_out: bool = False
    #: any memory item of the answer was due when it was answered (a "watered" word)
    was_due: bool = False
    #: predicted p(correct) before the answer — mean retrievability; None for new material
    p_correct: float | None = None
    #: every memory item was already known and not due: replaying for its own sake (XP x0.25)
    regrind: bool = False


@dataclass(slots=True)
class _Pending:
    """Per-memory-item working state across one batch."""

    state: ItemState | None
    suspended: bool
    lapses: list[datetime] = field(default_factory=list)
    recompute: bool = False
    dirty: bool = False


def clamp_rt(rt_ms: int) -> int:
    return max(RT_MIN_MS, min(RT_MAX_MS, rt_ms))


def fsrs_grade(item: ItemRecord, result: GradeResult, rt_ms: int, hints_used: int) -> Grade | None:
    """The FSRS grade for the item as a whole, or None when it was not graded."""
    if result.verdict is Verdict.UNGRADED:
        return None
    median = POPULATION_MEDIAN_RT_MS.get(FAMILY.get(item.type_id, "choice"), 10_000)
    return grade_response(
        correct=result.verdict is Verdict.CORRECT,
        rt_ms=rt_ms,
        median_rt_ms=median,
        hints_used=hints_used,
        timed_out=result.reason == "timeout",
    )


def per_memory_item_grades(
    item: ItemRecord, result: GradeResult, submission: dict[str, Any], item_grade: Grade
) -> dict[str, Grade]:
    """One grade per memory item. Pairs games grade each lexeme by its own pair (a timed-out
    word race credits the pairs matched; a tap_pairs mix-up fails only the confused pairs)."""
    grades = dict.fromkeys(item.memory_items, item_grade)
    lexis = item.targets.get("lexis", ())
    pairs = item.prompt.get("pairs") or []
    if item.type_id in PAIRS_TYPES and len(lexis) == len(pairs) and result.elements is not None:
        matched_ok: set[int] = set()
        for ok, match in zip(result.elements, submission.get("matches") or [], strict=False):
            if ok and isinstance(match, list) and match:
                matched_ok.add(int(match[0]))
        # a matched pair keeps the item's grade (Hard after a hint), or Good if the item failed
        good = item_grade if item_grade != Grade.AGAIN else Grade.GOOD
        for i, lexeme_id in enumerate(lexis):
            for m in item.memory_items:
                if m.startswith(f"{lexeme_id}."):
                    grades[m] = good if i in matched_ok else Grade.AGAIN
    return grades


class ReviewService:
    def __init__(self, session: AsyncSession, catalog: ContentCatalog, clock: Clock) -> None:
        self._session = session
        self._catalog = catalog
        self._clock = clock
        self._repo = ReviewRepository(session)
        self._ids = Uuid7Sequence()

    async def ingest(
        self,
        learner_id: UUID,
        *,
        tz: str,
        desired_retention: float,
        reviews: Sequence[IncomingReview],
        disputes: Sequence[IncomingDispute] = (),
    ) -> list[Outcome]:
        """Ingest a batch in one transaction (the caller owns it)."""
        now = self._clock.now()
        await self._repo.lock_learner(learner_id)
        keys = await self._repo.existing_keys(
            learner_id, [r.client_uuid for r in reviews] + [d.client_uuid for d in disputes]
        )
        outcomes: dict[UUID, Outcome] = {}

        fresh: list[IncomingReview] = []
        for r in reviews:
            seen = keys.get(r.client_uuid)
            if seen is not None:
                outcomes[r.client_uuid] = Outcome(
                    r.client_uuid, "duplicate", verdict=seen.verdict, grade=seen.grade
                )
            elif r.client_uuid in {f.client_uuid for f in fresh}:
                outcomes[r.client_uuid] = Outcome(r.client_uuid, "duplicate")
            else:
                fresh.append(r)
        # The order things happened: device time, then the session's monotonic clock.
        fresh.sort(key=lambda r: (r.created_at, r.monotonic_ms, str(r.client_uuid)))

        touched = {
            m
            for r in fresh
            if (item := self._catalog.item(r.item_id)) is not None
            for m in item.memory_items
        }
        stored = await self._repo.states(learner_id, touched)
        earliest = min((r.created_at for r in fresh), default=now)
        lapses = await self._repo.lapse_times(learner_id, touched, earliest - LAPSE_WINDOW)
        pending: dict[str, _Pending] = {
            m: _Pending(
                state=stored[m].item if m in stored else None,
                suspended=stored[m].suspended if m in stored else False,
                lapses=list(lapses.get(m, [])),
            )
            for m in touched
        }

        for r in fresh:
            outcomes[r.client_uuid] = await self._ingest_one(
                learner_id, r, now, tz, desired_retention, pending
            )

        for m, p in pending.items():
            if p.recompute:
                history = await self._repo.history(learner_id, [m])
                state = replay(
                    history.get(m, []),
                    learner_id=str(learner_id),
                    memory_item_id=m,
                    tz=tz,
                    desired_retention=desired_retention,
                    suspended=p.suspended,
                )
                if state is not None:
                    await self._repo.upsert_state(learner_id, m, state)
            elif p.state is not None and p.dirty:
                await self._repo.upsert_state(learner_id, m, p.state)

        for d in disputes:
            # seen before, or a second copy in this same batch
            if d.client_uuid in keys or d.client_uuid in outcomes:
                outcomes.setdefault(d.client_uuid, Outcome(d.client_uuid, "duplicate"))
                continue
            await self._repo.insert_dispute(
                {
                    "learner_id": learner_id,
                    "client_uuid": d.client_uuid,
                    "review_client_uuid": d.review_client_uuid,
                    "item_id": d.item_id,
                }
            )
            await self._repo.insert_key(
                {"learner_id": learner_id, "client_uuid": d.client_uuid, "kind": "dispute"}
            )
            outcomes[d.client_uuid] = Outcome(d.client_uuid, "accepted")

        order = [r.client_uuid for r in reviews] + [d.client_uuid for d in disputes]
        return [outcomes[u] for u in dict.fromkeys(order)]

    async def _ingest_one(
        self,
        learner_id: UUID,
        r: IncomingReview,
        now: datetime,
        tz: str,
        desired_retention: float,
        pending: dict[str, _Pending],
    ) -> Outcome:
        item = self._catalog.item(r.item_id)
        if item is None:
            return Outcome(r.client_uuid, "rejected", problem="unknown_item")
        try:
            result = grade(
                item.type_id,
                item.prompt,
                item.answer,
                r.submission,
                self._catalog.grade_context(item),
            )
        except InvalidSubmission:
            return Outcome(r.client_uuid, "rejected", problem="invalid_submission")

        ts = r.created_at
        clock_adjusted = False
        if ts > now + CLOCK_ALLOWANCE:
            ts, clock_adjusted = now, True
        rt_ms = clamp_rt(r.rt_ms)
        item_grade = fsrs_grade(item, result, rt_ms, r.hints_used)
        before = [pending[m].state for m in item.memory_items if m in pending]
        known = [s for s in before if s is not None]
        was_due = any(s.due <= ts for s in known)
        p_correct = (
            sum(
                retrievability(max((ts - s.last_review).total_seconds() / 86_400, 0.0), s.stability)
                for s in known
            )
            / len(known)
            if known and len(known) == len(before)
            else None
        )
        regrind = (
            bool(before)
            and len(known) == len(before)
            and not was_due
            and all(s.state in KNOWN_STATES for s in known)
        )
        attempt_id = self._ids.next()

        await self._repo.insert_attempt(
            {
                "learner_id": learner_id,
                "ts": ts,
                "id": attempt_id,
                "client_uuid": r.client_uuid,
                "item_id": item.id,
                "type_id": item.type_id,
                "unit_id": item.unit_id,
                "session_id": r.session_id,
                "content_version": r.content_version[:64],
                "submission": r.submission,
                "rt_ms": rt_ms,
                "hints_used": max(0, min(r.hints_used, 99)),
                "plays_used": max(0, min(r.plays_used, 999)),
                "verdict": result.verdict.value,
                "grade": int(item_grade) if item_grade is not None else None,
                "typo": result.typo is not None,
                "local_verdict": r.local_verdict,
                "clock_adjusted": clock_adjusted,
                "client_created_at": r.created_at,
            }
        )

        if item_grade is not None:
            grades = per_memory_item_grades(item, result, r.submission, item_grade)
            rows: list[dict[str, Any]] = []
            for memory_item_id in dict.fromkeys(item.memory_items):
                g = grades[memory_item_id]
                row_id = self._ids.next()
                rows.append(
                    {
                        "learner_id": learner_id,
                        "ts": ts,
                        "id": row_id,
                        "attempt_id": attempt_id,
                        "memory_item_id": memory_item_id,
                        "grade": int(g),
                        "item_id": item.id,
                        "type_id": item.type_id,
                        "scheduler_version": SCHEDULER_VERSION,
                    }
                )
                p = pending[memory_item_id]
                if p.state is not None and ts < p.state.last_review:
                    p.recompute = True  # arrived late: re-derive from the whole log
                    continue
                if p.recompute:
                    continue
                prior = [t for t in p.lapses if ts - t < LAPSE_WINDOW and t <= ts]
                p.state = apply_review(
                    p.state,
                    LoggedReview(
                        ts=ts,
                        grade=int(g),
                        item_id=item.id,
                        type_id=item.type_id,
                        order=str(row_id),
                    ),
                    learner_id=str(learner_id),
                    memory_item_id=memory_item_id,
                    tz=tz,
                    desired_retention=desired_retention,
                    prior_lapses=prior,
                    suspended=p.suspended,
                )
                if g == Grade.AGAIN:
                    p.lapses.append(ts)
                p.dirty = True
            await self._repo.insert_log_rows(rows)

        await self._repo.insert_key(
            {
                "learner_id": learner_id,
                "client_uuid": r.client_uuid,
                "kind": "review",
                "attempt_ts": ts,
                "attempt_id": attempt_id,
                "verdict": result.verdict.value,
                "grade": int(item_grade) if item_grade is not None else None,
            }
        )
        return Outcome(
            r.client_uuid,
            "accepted",
            verdict=result.verdict.value,
            grade=int(item_grade) if item_grade is not None else None,
            typo=result.typo,
            item=item,
            answered_at=ts,
            attempt_id=attempt_id,
            session_id=r.session_id,
            rt_ms=rt_ms,
            hints_used=r.hints_used,
            timed_out=result.reason == "timeout",
            was_due=was_due,
            p_correct=p_correct,
            regrind=regrind,
        )
