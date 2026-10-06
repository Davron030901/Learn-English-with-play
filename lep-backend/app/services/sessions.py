"""Composed sessions (docs/08 §5; backend brief Phase 5): the I/O around ``domain.composer``.

``compose`` reads the learner's memory state, their recent response times, today's new targets
and the node-tier record, turns them into composer inputs, and stores the plan it gets back.
The composer itself is pure; everything here is gathering and storing.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, time
from typing import Any, Final
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.content.catalog import ITEM_BEARING_KINDS, ContentCatalog, ItemRecord
from app.domain import composer as cp
from app.domain.fsrs import retrievability
from app.domain.grading import FAMILY
from app.domain.mastery import MasteryState
from app.domain.streaks import local_day
from app.ids import uuid7
from app.models.gamification import NodeProgress
from app.models.review import MemoryState, ReviewAttempt, ReviewLog
from app.models.sessions import LearnerSession
from app.repositories.learners import LearnerRepository, Profile
from app.services.progress import FAMILIES_FOR, ProgressService, _indexes
from app.services.reviews import POPULATION_MEDIAN_RT_MS

#: the learner's own median per family needs this many answers in that family
MIN_RT_SAMPLES: Final = 8
RECENT_ATTEMPTS: Final = 400
#: seconds one review takes on average, to turn the daily goal into "a normal day's reviews"
SECONDS_PER_REVIEW: Final = 10


class SessionError(Exception):
    def __init__(self, kind: str, detail: str, *, available_at: datetime | None = None) -> None:
        super().__init__(detail)
        self.kind = kind
        self.available_at = available_at


@dataclass(frozen=True, slots=True)
class Composed:
    row: LearnerSession
    backlog: cp.Backlog
    new_today: int
    new_cap: int


def _plan_json(plan: cp.Plan, catalog: ContentCatalog) -> dict[str, Any]:
    steps: list[dict[str, Any]] = []
    for s in plan.steps:
        if s.card is None:
            steps.append({"role": s.role, "seconds": s.seconds})
            continue
        item = catalog.items[s.card.item_id]
        steps.append(
            {
                "role": s.role,
                "item_id": s.card.item_id,
                "type_id": s.card.type_id,
                "unit_id": item.unit_id,
                "node_id": item.node_id,
                "tier": item.tier,
                "memory_item_id": s.memory_item_id,
                "target": s.card.target,
                "modality": cp.modality(s.card.type_id),
                "seconds": round(s.card.seconds, 1),
                "new_targets": sorted(s.card.new_targets),
            }
        )
    return {
        "steps": steps,
        "estimated_seconds": round(plan.seconds, 1),
        "budget_seconds": plan.budget_s,
        "review_share": plan.review_share,
        "new_targets": sorted(plan.new_targets),
        "deferred": list(plan.deferred),
    }


class SessionService:
    def __init__(self, session: AsyncSession, catalog: ContentCatalog, clock: Clock) -> None:
        self._session = session
        self._catalog = catalog
        self._clock = clock
        self._ix = _indexes(catalog)

    # ------------------------------------------------------------------- reads

    async def get(self, learner_id: UUID, session_id: UUID) -> LearnerSession:
        row = await self._session.get(LearnerSession, (learner_id, session_id))
        if row is None:
            raise SessionError("not_found", "there is no such session")
        return row

    async def complete(self, learner_id: UUID, session_id: UUID) -> LearnerSession:
        row = await self._session.get(
            LearnerSession, (learner_id, session_id), with_for_update=True
        )
        if row is None:
            raise SessionError("not_found", "there is no such session")
        if row.status != "completed":
            row.status = "completed"
            row.completed_at = self._clock.now()
        return row

    # ------------------------------------------------------------------- compose

    async def compose(
        self, learner_id: UUID, minutes: int, node_id: str | None, tier: int | None
    ) -> Composed:
        profile = await LearnerRepository(self._session).profile(learner_id)
        if profile is None:
            raise SessionError("gone", "this account no longer exists")
        now = self._clock.now()
        states = {
            m.memory_item_id: m
            for (m,) in await self._session.execute(
                select(MemoryState).where(MemoryState.learner_id == learner_id)
            )
        }
        # a target is new only when none of its memory items has state (DECISIONS §8.3)
        seen = frozenset(m.rpartition(".")[0] for m in states)
        seconds = await self._seconds_by_family(learner_id)
        progress = ProgressService(self._session, self._catalog)
        tiers, done = await progress.path(learner_id)
        current = progress.current_unit(tiers, done)
        level = self._catalog.units[current].cefr

        due = [
            m
            for m in states.values()
            if m.due <= now and m.state not in ("suspended", "retired") and not m.suspended
        ]
        normal = max(1, profile.daily_goal_min * 60 // SECONDS_PER_REVIEW)
        bl = cp.backlog(len(due), normal)
        new_today = await self._new_targets_today(learner_id, profile, now)
        cap = cp.new_cap_per_day(level)
        allowance = max(0, cap - new_today) if bl.new_allowed else 0

        lesson: list[cp.Card] = []
        node_share: float | None = None
        if node_id is not None:
            node = self._catalog.nodes.get(node_id)
            if node is None or node.kind not in ITEM_BEARING_KINDS:
                raise SessionError("not_found", "there is no such lesson node")
            want = tier or 1
            if not node.tiers.get(want):
                raise SessionError("not_found", "this node has no such tier")
            gate = cp.tier_gate(
                want,
                await self._completed_tiers(learner_id, node_id),
                now,
                populated=[t for t, ids in node.tiers.items() if ids],
            )
            if not gate.allowed:
                raise SessionError(
                    "tier_locked",
                    (
                        "tier 3 opens three days after tier 2"
                        if gate.reason == "spacing"
                        else "finish the tier before this one first"
                    ),
                    available_at=gate.available_at,
                )
            lesson = [self._card(self._catalog.items[i], seconds, seen) for i in node.tiers[want]]
            fresh: set[str] = set()
            for c in lesson:
                fresh |= c.new_targets
            # an opened lesson is never cut short: it is refused whole, with the reason, when it
            # would bring new material during a backlog, or take the day past its new-target
            # cap — except the day's first lesson, so a tier larger than the cap can be played
            if fresh and not bl.new_allowed:
                raise SessionError(
                    "new_cap", "catch up on your reviews first; new lessons wait until then"
                )
            if fresh and new_today > 0 and len(fresh) > allowance:
                raise SessionError(
                    "new_cap",
                    "that is enough new material for today; review now, more tomorrow",
                )
            # reviews mixed into the lesson may still introduce what the allowance has left
            allowance = max(0, allowance - len(fresh))
            # the node-tier's own items come first and whole (its 60 / 30 / 0 % new mix is built
            # into the content, docs/08 §4.3); due reviews fill the time that is left
            node_share = 1.0
            tier = want
        else:
            lesson = self._next_new(current, seen, seconds)

        leech_failures = await self._recent_failure_types(
            learner_id, [m.memory_item_id for m in due if m.state == "leech"]
        )
        # rank everything due by priority first, then cap the day's queue (docs/08 §2.10)
        built = (self._review(m, now, seconds, level, seen, leech_failures) for m in due)
        reviews = sorted(
            (r for r in built if r is not None),
            key=lambda r: (-r.priority, r.memory_item_id),
        )[: bl.queue_cap]
        warm = [
            r
            for r in (
                self._review(m, now, seconds, level, seen, {})
                for m in states.values()
                if m.due > now and m.state in ("young", "retained", "durable")
            )
            if r is not None and r.retrievability >= cp.WARMUP_MIN_P
        ][:20]
        close_cards = {
            r.memory_item_id: alt
            for r in reviews
            if (alt := self._other_card(r, seconds, seen)) is not None
        }

        plan = cp.compose(
            cp.Request(
                minutes=minutes,
                reviews=reviews,
                warmups=warm,
                lesson=lesson,
                new_allowance=allowance,
                node_share=node_share,
                close_cards=close_cards,
            )
        )
        row = LearnerSession(
            learner_id=learner_id,
            id=uuid7(),
            kind="node" if node_id else "practice",
            minutes=minutes,
            node_id=node_id,
            tier=tier,
            plan=_plan_json(plan, self._catalog),
            status="open",
            created_at=now,
            completed_at=None,
        )
        self._session.add(row)
        await self._session.flush()
        return Composed(row, bl, new_today, cap)

    # ------------------------------------------------------------------- inputs

    def _card(self, item: ItemRecord, seconds: dict[str, float], seen: frozenset[str]) -> cp.Card:
        family = FAMILY.get(item.type_id, "choice")
        target = cp.target_of(item.memory_items, item.id)
        fresh = frozenset(
            t
            for t in (m.rpartition(".")[0] for m in item.memory_items if not m.startswith("txt."))
            if t not in seen
        )
        return cp.Card(
            item_id=item.id,
            type_id=item.type_id,
            target=target,
            memory_items=item.memory_items,
            seconds=seconds.get(family, cp.expected_seconds(10_000)),
            new_targets=fresh,
        )

    def _importance(self, memory_item_id: str) -> float:
        """Frequency band, 0.5–1.5: the course teaches frequent words first (docs/08 §5)."""
        lexeme = memory_item_id.rpartition(".")[0]
        rank = self._ix.rank.get(lexeme)
        if rank is None or not self._ix.rank:
            return 1.0
        return 1.5 - rank / max(1, len(self._ix.rank) - 1)

    def _review(
        self,
        m: MemoryState,
        now: datetime,
        seconds: dict[str, float],
        level: str,
        seen: frozenset[str],
        failed_types: dict[str, list[str]],
    ) -> cp.Review | None:
        item_id = self._pick_item(m, seen, failed_types.get(m.memory_item_id, []))
        if item_id is None:
            return None
        item = self._catalog.items[item_id]
        r = retrievability(max((now - m.last_review).total_seconds() / 86_400, 0.0), m.stability)
        return cp.Review(
            card=self._card(item, seconds, seen),
            memory_item_id=m.memory_item_id,
            retrievability=r,
            stability=m.stability,
            importance=self._importance(m.memory_item_id),
            leech=m.state == "leech",
            in_current_level=item.cefr[:2] == level[:2],
        )

    def _introduces(self, item_id: str, seen: frozenset[str]) -> bool:
        return any(
            m.rpartition(".")[0] not in seen
            for m in self._catalog.items[item_id].memory_items
            if not m.startswith("txt.")
        )

    def _pick_item(
        self, m: MemoryState, seen: frozenset[str], failed_types: Sequence[str] = ()
    ) -> str | None:
        """An exercise suited to the state, never the type used last time (docs/08 §5.1); for a
        leech, none of the types of its last three failures (forced variation). An exercise that
        would introduce an unseen target is used only when nothing else reviews the item."""
        candidates = [
            i for i in self._ix.items_for.get(m.memory_item_id, ()) if i in self._catalog.items
        ]
        if not candidates:
            return None
        clean = [i for i in candidates if not self._introduces(i, seen)]
        pool = clean or candidates
        avoid = {m.last_type_id, *failed_types[:3]} if m.state == "leech" else {m.last_type_id}
        try:
            state = MasteryState(m.state)
        except ValueError:
            state = MasteryState.LEARNING
        for family in FAMILIES_FOR.get(state, ("choice",)):
            for item_id in pool:
                t = self._catalog.items[item_id].type_id
                if FAMILY.get(t) == family and t not in avoid:
                    return item_id
        different = [i for i in pool if self._catalog.items[i].type_id not in avoid]
        return (different or pool)[0]

    def _other_card(
        self, r: cp.Review, seconds: dict[str, float], seen: frozenset[str]
    ) -> cp.Card | None:
        for item_id in self._ix.items_for.get(r.memory_item_id, ()):
            item = self._catalog.items.get(item_id)
            if item is None or item.type_id == r.card.type_id or self._introduces(item_id, seen):
                continue
            return self._card(item, seconds, seen)
        return None

    def _next_new(
        self, current: str, seen: frozenset[str], seconds: dict[str, float]
    ) -> list[cp.Card]:
        """New material for free practice: the current unit's tier-1 items not yet met, in order."""
        out: list[cp.Card] = []
        for node_id in self._catalog.units[current].node_ids:
            node = self._catalog.nodes[node_id]
            if node.kind not in ITEM_BEARING_KINDS:
                continue
            for item_id in node.tiers.get(1, ()):
                card = self._card(self._catalog.items[item_id], seconds, seen)
                if card.new_targets:
                    out.append(card)
        return out

    async def _seconds_by_family(self, learner_id: UUID) -> dict[str, float]:
        """Expected seconds per exercise family: the learner's median RT, else the population's."""
        rows = await self._session.execute(
            select(ReviewAttempt.type_id, ReviewAttempt.rt_ms)
            .where(ReviewAttempt.learner_id == learner_id)
            .order_by(ReviewAttempt.ts.desc())
            .limit(RECENT_ATTEMPTS)
        )
        by_family: dict[str, list[int]] = defaultdict(list)
        for r in rows:
            by_family[FAMILY.get(r.type_id, "choice")].append(r.rt_ms)
        out: dict[str, float] = {}
        for family, median in POPULATION_MEDIAN_RT_MS.items():
            own = by_family.get(family, [])
            value = statistics.median(own) if len(own) >= MIN_RT_SAMPLES else median
            out[family] = cp.expected_seconds(value)
        return out

    async def _new_targets_today(self, learner_id: UUID, profile: Profile, now: datetime) -> int:
        """Syllabus targets whose first review of *any* aspect was today, in the learner's own
        time zone. Story comprehension (txt.*) is not a target the cap counts."""
        day = local_day(now, profile.tz)
        start = datetime.combine(day, time.min, tzinfo=ZoneInfo(profile.tz))
        rows = await self._session.execute(
            select(ReviewLog.memory_item_id, func.min(ReviewLog.ts).label("first"))
            .where(ReviewLog.learner_id == learner_id)
            .group_by(ReviewLog.memory_item_id)
        )
        first: dict[str, datetime] = {}
        for r in rows:
            if r.memory_item_id.startswith("txt."):
                continue
            target = r.memory_item_id.rpartition(".")[0]
            if target not in first or r.first < first[target]:
                first[target] = r.first
        return sum(1 for at in first.values() if at >= start)

    async def _recent_failure_types(
        self, learner_id: UUID, memory_item_ids: Sequence[str]
    ) -> dict[str, list[str]]:
        """The exercise types of each leech's most recent failures, newest first."""
        if not memory_item_ids:
            return {}
        rows = await self._session.execute(
            select(ReviewLog.memory_item_id, ReviewLog.type_id)
            .where(
                ReviewLog.learner_id == learner_id,
                ReviewLog.memory_item_id.in_(sorted(set(memory_item_ids))),
                ReviewLog.grade == 1,
            )
            .order_by(ReviewLog.ts.desc())
        )
        out: dict[str, list[str]] = defaultdict(list)
        for r in rows:
            if len(out[r.memory_item_id]) < 3:
                out[r.memory_item_id].append(r.type_id)
        return dict(out)

    async def _completed_tiers(self, learner_id: UUID, node_id: str) -> dict[int, datetime]:
        rows = await self._session.execute(
            select(NodeProgress.tier, NodeProgress.completed_at).where(
                NodeProgress.learner_id == learner_id, NodeProgress.node_id == node_id
            )
        )
        return {r.tier: r.completed_at for r in rows}


def summary_counts(plan: dict[str, Any]) -> dict[str, int]:
    roles: dict[str, int] = defaultdict(int)
    steps: Sequence[dict[str, Any]] = plan.get("steps", [])
    for s in steps:
        roles[s["role"]] += 1
    return dict(roles)
