"""Progress, the Word Garden and the due queue — the reads behind docs/10 §4.1 and docs/16 E09.

Coverage comes first and is honest about what it is:

* a lexeme is **known** when the weakest of the aspects the course exercises for it is at least
  *retained* (S ≥ 21 days) — the minimum, never the maximum or the mean (docs/08 §3);
* the coverage percentage is an **estimate**: the known lexemes' share of the course word list,
  weighted by a Zipf curve over the course order (the course introduces frequent words first).
  It is labelled as an estimate until the monthly retention audit runs (docs/08 §9).

The garden turns the same memory state into plants: the stage is the weakest aspect's mastery
state, the health is its retrievability now, and a plant is thirsty when any aspect is due.
Plants never die — forgetting is gradual and recoverable (docs/16 E09).
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Container, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.catalog import ITEM_BEARING_KINDS, ContentCatalog
from app.domain.accessibility import NO_PROFILE, A11yProfile, degraded, presentable
from app.domain.fsrs import retrievability
from app.domain.grading import FAMILY
from app.domain.mastery import KNOWN_STATES, MasteryState
from app.models.certification import RetentionAudit
from app.models.gamification import Badge, NodeProgress, UnitProgress
from app.models.review import MemoryState

STAGE: Final[dict[MasteryState, str]] = {
    MasteryState.LEARNING: "seed",
    MasteryState.YOUNG: "sprout",
    MasteryState.RETAINED: "bush",
    MasteryState.DURABLE: "bloom",
    MasteryState.RETIRED: "tree",
    MasteryState.LEECH: "leech",
    MasteryState.SUSPENDED: "paused",
}
STAGE_ORDER: Final = ("seed", "sprout", "bush", "bloom", "tree", "leech", "paused")
#: The order in which a weaker aspect state makes the plant weaker.
_WEAKNESS: Final[dict[MasteryState, int]] = {
    MasteryState.SUSPENDED: -1,
    MasteryState.LEECH: 0,
    MasteryState.LEARNING: 1,
    MasteryState.YOUNG: 2,
    MasteryState.RETAINED: 3,
    MasteryState.DURABLE: 4,
    MasteryState.RETIRED: 5,
}
SECONDS_PER_REVIEW: Final = 8
BEDS_PER_PAGE: Final = 10
#: a memory check counts as current for a month and a week (the checks are 28 days apart)
AUDIT_FRESH: Final = timedelta(days=35)

COVERAGE_METHOD: Final = (
    "zipf-weighted share of the course word list (teaching order = frequency order)"
)

#: Exercise families suited to each mastery state when choosing a review item (docs/08 §5.1).
FAMILIES_FOR: Final[dict[MasteryState, tuple[str, ...]]] = {
    MasteryState.LEARNING: ("choice", "pairs", "bins"),
    MasteryState.YOUNG: ("text", "bank", "choice"),
    MasteryState.RETAINED: ("speak", "text", "bank"),
    MasteryState.DURABLE: ("speak", "text"),
    MasteryState.RETIRED: ("speak", "text"),
    MasteryState.LEECH: ("text", "bank", "choice", "pairs", "speak"),
}


@dataclass(frozen=True, slots=True)
class _Indexes:
    #: lexeme → the aspects the course exercises for it
    aspects: dict[str, frozenset[str]]
    #: lexeme → its rank in the course (0 = first taught)
    rank: dict[str, int]
    zipf_total: float
    #: memory item → items that review it
    items_for: dict[str, tuple[str, ...]]


_INDEX_CACHE: dict[str, _Indexes] = {}


def _indexes(catalog: ContentCatalog) -> _Indexes:
    """Built once per content version (the catalog is immutable while the process runs)."""
    hit = _INDEX_CACHE.get(catalog.version)
    if hit is None:
        hit = _INDEX_CACHE[catalog.version] = _build_indexes(catalog)
    return hit


def warm_indexes(catalog: ContentCatalog) -> None:
    """Build the indexes at start-up, so no learner's first request pays for it (seconds)."""
    _indexes(catalog)


def _build_indexes(catalog: ContentCatalog) -> _Indexes:
    aspects: dict[str, set[str]] = defaultdict(set)
    items_for: dict[str, list[str]] = defaultdict(list)
    for item in catalog.items.values():
        for m in item.memory_items:
            items_for[m].append(item.id)
            if m.startswith("lex."):
                lexeme, _, aspect = m.rpartition(".")
                aspects[lexeme].add(aspect)
    order = sorted(catalog.lexemes)
    rank = {lex: i for i, lex in enumerate(order)}
    return _Indexes(
        aspects={k: frozenset(v) for k, v in aspects.items()},
        rank=rank,
        zipf_total=sum(1 / (i + 1) for i in range(len(order))),
        items_for={k: tuple(v) for k, v in items_for.items()},
    )


@dataclass(frozen=True, slots=True)
class LexemeStatus:
    lexeme_id: str
    known: bool
    weakest: MasteryState
    health: float
    due_at: datetime
    thirsty: bool
    aspects: dict[str, str]


class ProgressService:
    def __init__(self, session: AsyncSession, catalog: ContentCatalog) -> None:
        self._session = session
        self._catalog = catalog
        self._ix = _indexes(catalog)

    async def _states(self, learner_id: UUID) -> list[MemoryState]:
        rows = await self._session.execute(
            select(MemoryState).where(MemoryState.learner_id == learner_id)
        )
        return [m for (m,) in rows]

    async def lexemes(self, learner_id: UUID, now: datetime) -> dict[str, LexemeStatus]:
        by_lexeme: dict[str, dict[str, MemoryState]] = defaultdict(dict)
        for m in await self._states(learner_id):
            if m.memory_item_id.startswith("lex."):
                lexeme, _, aspect = m.memory_item_id.rpartition(".")
                by_lexeme[lexeme][aspect] = m
        out: dict[str, LexemeStatus] = {}
        for lexeme, seen in by_lexeme.items():
            required = self._ix.aspects.get(lexeme, frozenset(seen))
            states = {a: MasteryState(s.state) for a, s in seen.items()}
            weakest_state = min(states.values(), key=lambda s: _WEAKNESS[s])
            if required - set(seen):
                weakest_state = min(
                    weakest_state, MasteryState.LEARNING, key=lambda s: _WEAKNESS[s]
                )
            healths = [
                retrievability(
                    max((now - s.last_review).total_seconds() / 86_400, 0.0), s.stability
                )
                for s in seen.values()
            ]
            known = not (required - set(seen)) and all(states[a] in KNOWN_STATES for a in required)
            due_at = min(s.due for s in seen.values())
            out[lexeme] = LexemeStatus(
                lexeme_id=lexeme,
                known=known,
                weakest=weakest_state,
                health=round(min(healths), 3),
                due_at=due_at,
                thirsty=due_at <= now,
                aspects={a: states[a].value for a in sorted(states)},
            )
        return out

    # ------------------------------------------------------------------- coverage and level

    async def audited(self, learner_id: UUID, now: datetime) -> bool:
        """True while a memory check (docs/08 §9) finished within the last ``AUDIT_FRESH``: the
        memory model behind "known" has then been checked against what the learner recalled,
        not only predicted."""
        found = await self._session.execute(
            select(RetentionAudit.id)
            .where(
                RetentionAudit.learner_id == learner_id,
                RetentionAudit.completed_at.is_not(None),
                RetentionAudit.completed_at >= now - AUDIT_FRESH,
            )
            .limit(1)
        )
        return found.first() is not None

    def coverage(self, lexemes: dict[str, LexemeStatus]) -> tuple[int, int, float]:
        known = [k for k, v in lexemes.items() if v.known]
        weight = sum(1 / (self._ix.rank[k] + 1) for k in known if k in self._ix.rank)
        percent = round(100 * weight / self._ix.zipf_total, 1) if self._ix.zipf_total else 0.0
        return len(known), len(lexemes) - len(known), percent

    async def path(self, learner_id: UUID) -> tuple[dict[str, dict[str, int]], set[str]]:
        rows = await self._session.execute(
            select(NodeProgress.node_id, NodeProgress.tier).where(
                NodeProgress.learner_id == learner_id
            )
        )
        tiers: dict[str, dict[str, int]] = defaultdict(dict)
        for r in rows:
            unit = r.node_id[:6]
            tiers[unit][r.node_id] = max(tiers[unit].get(r.node_id, 0), r.tier)
        units = await self._session.execute(
            select(UnitProgress.unit_id).where(UnitProgress.learner_id == learner_id)
        )
        return dict(tiers), {r.unit_id for r in units}

    def current_unit(self, tiers: dict[str, dict[str, int]], done: set[str]) -> str:
        order = self._catalog.unit_order()
        started = [u for u in order if u in tiers or u in done]
        if not started:
            return order[0]
        for u in order[order.index(started[0]) :]:
            if u not in done:
                return u
        return order[-1]

    def level(self, current: str, done: set[str]) -> tuple[str, int, int]:
        cefr = self._catalog.units[current].cefr
        same = [u for u in self._catalog.unit_order() if self._catalog.units[u].cefr == cefr]
        return cefr, sum(1 for u in same if u in done), len(same)

    async def badges(self, learner_id: UUID) -> list[tuple[str, str, datetime]]:
        rows = await self._session.execute(
            select(Badge.badge_id, Badge.unit_id, Badge.awarded_at)
            .where(Badge.learner_id == learner_id)
            .order_by(Badge.awarded_at, Badge.badge_id)
        )
        return [(r.badge_id, r.unit_id, r.awarded_at) for r in rows]

    # ------------------------------------------------------------------- garden

    def stages(self, lexemes: dict[str, LexemeStatus]) -> dict[str, int]:
        counts = dict.fromkeys(STAGE_ORDER, 0)
        for v in lexemes.values():
            counts[STAGE[v.weakest]] += 1
        return counts

    def beds(
        self, lexemes: dict[str, LexemeStatus], cursor: int, unit_id: str | None
    ) -> tuple[list[tuple[str, list[LexemeStatus]]], int | None]:
        by_unit: dict[str, list[LexemeStatus]] = defaultdict(list)
        for lexeme, status in lexemes.items():
            lex = self._catalog.lexemes.get(lexeme)
            if lex is not None:
                by_unit[lex.unit_id].append(status)
        order = [
            u
            for u in self._catalog.unit_order()
            if u in by_unit and (unit_id is None or u == unit_id)
        ]
        page = order[cursor : cursor + BEDS_PER_PAGE]
        nxt = cursor + BEDS_PER_PAGE if cursor + BEDS_PER_PAGE < len(order) else None
        return [(u, sorted(by_unit[u], key=lambda s: s.lexeme_id)) for u in page], nxt

    # ------------------------------------------------------------------- due queue

    async def due(
        self, learner_id: UUID, now: datetime, limit: int, a11y: A11yProfile = NO_PROFILE
    ) -> tuple[int, list[tuple[MemoryState, str, float]]]:
        states = [
            m
            for m in await self._states(learner_id)
            if m.due <= now
            and m.state not in ("suspended", "retired")
            and self.reviewable(m.memory_item_id, a11y)
        ]

        def r_now(m: MemoryState) -> float:
            return retrievability(
                max((now - m.last_review).total_seconds() / 86_400, 0.0), m.stability
            )

        # most-forgotten first (docs/08 §5: priority = 1 - R, leeches weighted up)
        states.sort(key=lambda m: -((1 - r_now(m)) * (1.3 if m.state == "leech" else 1.0)))
        picked: list[tuple[MemoryState, str, float]] = []
        used_items: set[str] = set()
        for m in states:
            item_id = self.review_item(m, used_items, a11y=a11y)
            if item_id is None:
                continue
            used_items.add(item_id)
            picked.append((m, item_id, round(r_now(m), 3)))
            if len(picked) >= limit:
                break
        return len(states), picked

    def review_item(
        self,
        m: MemoryState,
        used: set[str],
        within: frozenset[str] | None = None,
        a11y: A11yProfile = NO_PROFILE,
    ) -> str | None:
        """An item that reviews this memory item: a family suited to its state, never the type
        used last time (docs/08 §5.1), and not one already in this queue. With ``within``, items
        in those units are preferred (a unit the learner has not reached would spoil its story).
        Only types the accessibility profile can show; a degraded route (a listening item read
        from its transcript, a visual game as a list) only when nothing else reviews it."""
        candidates = [
            i
            for i in self._ix.items_for.get(m.memory_item_id, ())
            if i not in used and presentable(self._catalog.items[i].type_id, a11y)
        ]
        if within is not None:
            reached = [i for i in candidates if self._catalog.items[i].unit_id in within]
            candidates = reached or candidates
        if not candidates:
            return None
        return choose_item(
            candidates,
            self._catalog,
            FAMILIES_FOR.get(MasteryState(m.state), ("choice",)),
            {m.last_type_id},
            a11y,
        )

    def reviewable(self, memory_item_id: str, a11y: A11yProfile) -> bool:
        """Can anything review this memory item for this profile? Without a profile, every
        memory item counts as before; with one, an item only sound-only exercises review is not
        due for this learner — it could never be asked, and must not grow the backlog."""
        if not a11y.any:
            return True
        return any(
            presentable(self._catalog.items[i].type_id, a11y)
            for i in self._ix.items_for.get(memory_item_id, ())
            if i in self._catalog.items
        )


def choose_item(
    pool: Sequence[str],
    catalog: ContentCatalog,
    families: Sequence[str],
    avoid: Container[str],
    a11y: A11yProfile,
    *,
    strict: bool = False,
) -> str | None:
    """The exercise to review a memory item with, from ``pool`` (all presentable).

    The whole choice — a family suited to the state, else any type not to ``avoid``, else the
    first — is made among the full routes; a degraded route (a listening item read from its
    transcript, a visual game as a list) only when there is no full route at all. ``strict``:
    only the given families count, and None when nothing fits them."""
    full = [i for i in pool if not degraded(catalog.items[i].type_id, a11y)]
    taken = set(full)
    rest = [i for i in pool if i not in taken]
    for group in (full, rest):
        if not group:
            continue
        for family in families:
            for item_id in group:
                t = catalog.items[item_id].type_id
                if FAMILY.get(t) == family and t not in avoid:
                    return item_id
        if strict:
            continue
        different = [i for i in group if catalog.items[i].type_id not in avoid]
        return (different or group)[0]
    return None


def est_minutes(due_memory_items: int) -> int:
    return math.ceil(due_memory_items * SECONDS_PER_REVIEW / 60)


def required_nodes(catalog: ContentCatalog, unit_id: str) -> Sequence[str]:
    unit = catalog.units[unit_id]
    return [
        n
        for n in unit.node_ids
        if catalog.nodes[n].kind in ITEM_BEARING_KINDS and catalog.nodes[n].tiers
    ]
