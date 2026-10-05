"""Session composition (docs/08 §5, §4.3, §7; backend brief §6.6–6.8). Pure: no I/O.

Given what the scheduler knows — the due memory items with their retrievability, some well-known
items for a warm-up, and the material of a node-tier or the next new items — and a requested
length in minutes, build the ordered list of exercises for one session:

1. **Budget.** T ≤ 5 min is all review (never introduce with no time to consolidate); 6–10 is
   70 % review / 30 % new; 11–20 is 60 / 40; above 20 is 55 / 45 with a 15 s break every 12 min.
   Time one block cannot use flows to the other, except into "new" at T ≤ 5.
2. **Review block**, most urgent first: ``(1 - R) × importance × (1 + 0.3·leech) × (1 + 0.2·in
   current level)``. Leeches never take more than 5 % of the session's time (docs/08 §7).
3. **New block**, in syllabus order, capped by the day's allowance of new targets (15 a day at
   A1–A2, 20 at B1+, none while the backlog is over 3× a normal day).
4. **Interleaving**, enforced on the whole sequence as hard rules: at most 3 consecutive items on
   one target, at most 2 consecutive of one exercise type, at most 3 consecutive of one modality —
   and the modality rotates (read → listen → type → speak) whenever the next pick allows it. An
   item that cannot be placed without breaking a rule is left out and reported, never forced in.
5. **Warm-up** — up to 2 items predicted at p(correct) ≥ 0.95 — and **close** — the reviewed
   memory item with the lowest stability, through a different exercise (the recency effect).
6. **Fit**: Σ expected seconds (the learner's median response time per exercise family, plus
   time to read the feedback) stays within T + 10 %.

Node tiers (docs/08 §4.3): tier 1 is always open, tier 2 after tier 1, and tier 3 only once
**3 days** have passed since tier 2 — structural spacing, enforced here and in the award pipeline.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Final, Literal

# ------------------------------------------------------------------------- constants

#: The tier-3 spacing (docs/08 §4.3). The award pipeline uses the same value.
TIER3_SPACING: Final = timedelta(days=3)

MAX_TARGET_RUN: Final = 3
MAX_TYPE_RUN: Final = 2
MAX_MODALITY_RUN: Final = 3
MODALITY_CYCLE: Final = ("read", "listen", "type", "speak")

WARMUP_ITEMS: Final = 2
WARMUP_MIN_P: Final = 0.95
LEECH_TIME_SHARE: Final = 0.05
FIT_TOLERANCE: Final = 0.10
BREAK_SECONDS: Final = 15
BREAK_EVERY_S: Final = 12 * 60
#: time to read the feedback after an answer, added to the response time
FEEDBACK_S: Final = 3.0

NEW_PER_DAY: Final[dict[str, int]] = {"A1": 15, "A2": 15}
NEW_PER_DAY_DEFAULT: Final = 20
BACKLOG_NO_NEW_RATIO: Final = 3.0
BACKLOG_QUEUE_CAP_RATIO: Final = 1.5

#: what share of a node-tier session is the node's own material (docs/08 §4.3)
TIER_NEW_SHARE: Final[dict[int, float]] = {1: 0.60, 2: 0.30, 3: 0.0}

#: docs/09: each exercise type is one way of meeting the language
MODALITY: Final[dict[str, str]] = {
    "dictation_word": "listen",
    "dictation_sentence": "listen",
    "listen_gist_mcq": "listen",
    "listen_detail_gap": "listen",
    "listen_order_events": "listen",
    "minimal_pair_discrimination": "listen",
    "phoneme_id": "listen",
    "stress_tap": "listen",
    "type_from_l1": "type",
    "error_correct": "type",
    "spelling_bee": "type",
    "gap_fill_free": "type",
    "write_sentence": "type",
    "repeat_after": "speak",
    "speak_prompt": "speak",
    "read_aloud": "speak",
    "speak_roleplay": "speak",
    "speak_retell": "speak",
}


def modality(type_id: str) -> str:
    return MODALITY.get(type_id, "read")


def new_cap_per_day(cefr: str) -> int:
    return NEW_PER_DAY.get(cefr[:2], NEW_PER_DAY_DEFAULT)


def split(minutes: int) -> tuple[float, bool]:
    """(review share, breaks on) for a requested length (docs/08 §5 step 2)."""
    if minutes <= 5:
        return 1.0, False
    if minutes <= 10:
        return 0.70, False
    if minutes <= 20:
        return 0.60, False
    return 0.55, True


# ------------------------------------------------------------------------- inputs


@dataclass(frozen=True, slots=True)
class Card:
    """One exercise the session can show."""

    item_id: str
    type_id: str
    #: the syllabus target the run rule counts (a lexeme, grammar point, function …)
    target: str
    memory_items: tuple[str, ...]
    seconds: float
    #: syllabus targets this card would introduce (memory items never seen)
    new_targets: frozenset[str] = frozenset()


@dataclass(frozen=True, slots=True)
class Review:
    """A due (or, for the warm-up, a well-known) memory item and the card chosen to review it."""

    card: Card
    memory_item_id: str
    retrievability: float
    stability: float
    importance: float = 1.0
    leech: bool = False
    in_current_level: bool = False

    @property
    def priority(self) -> float:
        return (
            (1 - self.retrievability)
            * self.importance
            * (1.3 if self.leech else 1.0)
            * (1.2 if self.in_current_level else 1.0)
        )


@dataclass(frozen=True, slots=True)
class Request:
    minutes: int
    reviews: Sequence[Review] = ()
    #: candidates for the warm-up (p(correct) is their retrievability now)
    warmups: Sequence[Review] = ()
    #: new material, or a node-tier's items, in syllabus order
    lesson: Sequence[Card] = ()
    #: new targets the learner may still meet today (the cap less what today already brought)
    new_allowance: int = 10**9
    #: a node-tier session: the node's share of the time; None for free practice
    node_share: float | None = None
    #: a second card per memory item for the close (memory item → card, a different exercise)
    close_cards: Mapping[str, Card] = field(default_factory=dict)


# ------------------------------------------------------------------------- output

Role = Literal["warmup", "review", "lesson", "close", "break"]


@dataclass(frozen=True, slots=True)
class Step:
    role: Role
    card: Card | None
    seconds: float
    memory_item_id: str | None = None


@dataclass(frozen=True, slots=True)
class Plan:
    steps: tuple[Step, ...]
    budget_s: float
    review_share: float
    new_targets: frozenset[str]
    #: chosen but left out because no position kept every interleaving rule
    deferred: tuple[str, ...]

    @property
    def seconds(self) -> float:
        return sum(s.seconds for s in self.steps)

    @property
    def cards(self) -> list[Card]:
        return [s.card for s in self.steps if s.card is not None]


# ------------------------------------------------------------------------- the rules


def _runs_ok(seq: Sequence[Card], nxt: Card) -> bool:
    """Would appending ``nxt`` keep every hard interleaving rule?"""

    def run(key: str, limit: int, value: str) -> bool:
        n = 1
        for c in reversed(seq):
            if (
                c.target if key == "target" else c.type_id if key == "type" else modality(c.type_id)
            ) != value:
                break
            n += 1
            if n > limit:
                return False
        return True

    return (
        run("target", MAX_TARGET_RUN, nxt.target)
        and run("type", MAX_TYPE_RUN, nxt.type_id)
        and run("modality", MAX_MODALITY_RUN, modality(nxt.type_id))
        # the same memory item never twice in a row through the same exercise (docs/08 §5.1)
        and not (seq and seq[-1].item_id == nxt.item_id)
    )


def violations(cards: Sequence[Card]) -> list[str]:
    """Every broken interleaving rule in a sequence (for tests and assertions)."""
    return [
        f"position {i}: {c.item_id} ({c.type_id}, {c.target})"
        for i, c in enumerate(cards)
        if i and not _runs_ok(cards[:i], c)
    ]


def _next_modality(prev: str | None) -> str | None:
    if prev is None or prev not in MODALITY_CYCLE:
        return None
    return MODALITY_CYCLE[(MODALITY_CYCLE.index(prev) + 1) % len(MODALITY_CYCLE)]


def arrange(
    prefix: Sequence[Card], pool: Sequence[Card], *, window: int = 4
) -> tuple[list[Card], list[Card]]:
    """Append ``pool`` after ``prefix`` keeping the hard rules, staying close to the pool's order.

    At each step the first few placeable cards are considered and the one whose modality is next
    in the rotation (else any change of modality) wins; otherwise the earliest placeable one.
    Returns the arranged cards (prefix excluded) and those that could not be placed.
    """
    seq = list(prefix)
    placed: list[Card] = []
    left = list(pool)
    while left:
        ok = [i for i, c in enumerate(left) if _runs_ok(seq, c)]
        if not ok:
            break
        prev = modality(seq[-1].type_id) if seq else None
        want = _next_modality(prev)
        head = ok[:window]
        pick = next((i for i in head if modality(left[i].type_id) == want), None)
        if pick is None:
            pick = next((i for i in head if modality(left[i].type_id) != prev), head[0])
        card = left.pop(pick)
        seq.append(card)
        placed.append(card)
    return placed, left


# ------------------------------------------------------------------------- tier gates


@dataclass(frozen=True, slots=True)
class TierGate:
    allowed: bool
    reason: Literal["ok", "previous_tier", "spacing"]
    available_at: datetime | None = None


def tier_gate(tier: int, completed: Mapping[int, datetime], now: datetime) -> TierGate:
    """docs/08 §4.3: tier 1 always; tier 2 after tier 1; tier 3 ≥ 3 days after tier 2."""
    if tier <= 1:
        return TierGate(True, "ok")
    previous = completed.get(tier - 1)
    if previous is None:
        return TierGate(False, "previous_tier")
    if tier == 3:
        opens = previous + TIER3_SPACING
        if now < opens:
            return TierGate(False, "spacing", opens)
    return TierGate(True, "ok")


# ------------------------------------------------------------------------- backlog


@dataclass(frozen=True, slots=True)
class Backlog:
    due: int
    normal: int
    #: the day's review queue after an absence: at most 1.5 × a normal day (docs/08 §2.10)
    queue_cap: int
    new_allowed: bool
    #: honest "catching up: n days left"; 0 when there is no backlog
    days_left: int


def backlog(due: int, normal_per_day: int) -> Backlog:
    normal = max(1, normal_per_day)
    cap = max(1, int(normal * BACKLOG_QUEUE_CAP_RATIO))
    over = due > normal
    return Backlog(
        due=due,
        normal=normal,
        queue_cap=cap,
        new_allowed=due <= BACKLOG_NO_NEW_RATIO * normal,
        days_left=-(-due // cap) if over else 0,
    )


# ------------------------------------------------------------------------- composition


def _take_reviews(
    reviews: Iterable[Review], budget_s: float, leech_cap_s: float, taken: set[str]
) -> list[Review]:
    out: list[Review] = []
    items: set[str] = set()
    used = leech_s = 0.0
    for r in sorted(reviews, key=lambda r: (-r.priority, r.memory_item_id)):
        if r.memory_item_id in taken or r.card.item_id in items:
            continue
        if used + r.card.seconds > budget_s:
            continue
        if r.leech:
            if leech_s + r.card.seconds > leech_cap_s:
                continue
            leech_s += r.card.seconds
        out.append(r)
        items.add(r.card.item_id)
        used += r.card.seconds
        taken.add(r.memory_item_id)
    return out


def _take_lesson(cards: Iterable[Card], budget_s: float, allowance: int) -> list[Card]:
    out: list[Card] = []
    used = 0.0
    introduced: set[str] = set()
    for c in cards:
        fresh = c.new_targets - introduced
        if len(introduced) + len(fresh) > allowance:
            continue
        if used + c.seconds > budget_s:
            continue
        out.append(c)
        used += c.seconds
        introduced |= fresh
    return out


def compose(req: Request) -> Plan:
    budget = max(1, req.minutes) * 60.0
    review_share, breaks = split(req.minutes)
    node = req.node_share is not None
    if node:
        # a node-tier session: the node's material first; reviews fill what is left
        review_share = 1.0 - (req.node_share or 0.0)
    ceiling = budget * (1 + FIT_TOLERANCE)

    # 1. warm-up: up to two items the learner is almost sure to get right
    taken: set[str] = set()
    warm = [
        w
        for w in sorted(req.warmups, key=lambda w: -w.retrievability)
        if w.retrievability >= WARMUP_MIN_P
    ]
    warm_cards: list[Review] = []
    for w in warm:
        if len(warm_cards) == WARMUP_ITEMS:
            break
        if w.memory_item_id in taken or not _runs_ok([x.card for x in warm_cards], w.card):
            continue
        warm_cards.append(w)
        taken.add(w.memory_item_id)
    warm_s = sum(w.card.seconds for w in warm_cards)

    # 2. the two budgets; whatever one block cannot use flows to the other
    lesson_budget = 0.0 if (req.minutes <= 5 and not node) else budget * (1 - review_share)
    allowance = max(0, req.new_allowance)
    lesson = _take_lesson(req.lesson, lesson_budget, allowance)
    lesson_s = sum(c.seconds for c in lesson)
    review_budget = max(0.0, budget - warm_s - lesson_s)
    reviews = _take_reviews(req.reviews, review_budget, budget * LEECH_TIME_SHARE, taken)
    review_s = sum(r.card.seconds for r in reviews)
    if req.lesson and not (req.minutes <= 5 and not node):
        # reviews left time over: give it back to the lesson (still capped by the allowance)
        spare = max(0.0, budget - warm_s - review_s)
        if spare > lesson_s:
            lesson = _take_lesson(req.lesson, spare, allowance)

    # 3. order: warm-up, then reviews (urgent first) and the lesson (syllabus order), interleaved
    prefix = [w.card for w in warm_cards]
    pool = [r.card for r in reviews] + lesson
    arranged, deferred = arrange(prefix, pool)
    by_card = {id(r.card): r for r in reviews}
    lesson_ids = {id(c) for c in lesson}

    steps: list[Step] = [
        Step("warmup", w.card, w.card.seconds, w.memory_item_id) for w in warm_cards
    ]
    for c in arranged:
        rv = by_card.get(id(c))
        if rv is not None:
            steps.append(Step("review", c, c.seconds, rv.memory_item_id))
        elif id(c) in lesson_ids:
            steps.append(Step("lesson", c, c.seconds))

    # 4. close: the weakest memory item just reviewed, through a different exercise
    sequence = [s.card for s in steps if s.card is not None]
    total = sum(s.seconds for s in steps)
    placed_reviews = [by_card[id(c)] for c in arranged if id(c) in by_card]
    for r in sorted(placed_reviews, key=lambda r: (r.stability, r.memory_item_id)):
        alt = req.close_cards.get(r.memory_item_id)
        if alt is None or alt.type_id == r.card.type_id or alt.item_id == r.card.item_id:
            continue
        if total + alt.seconds > ceiling or not _runs_ok(sequence, alt):
            continue
        steps.append(Step("close", alt, alt.seconds, r.memory_item_id))
        sequence.append(alt)
        total += alt.seconds
        break

    # 5. long sessions: a 15-second break every 12 minutes of work
    if breaks:
        with_breaks: list[Step] = []
        since = 0.0
        for s in steps:
            if since >= BREAK_EVERY_S:
                with_breaks.append(Step("break", None, BREAK_SECONDS))
                since = 0.0
            with_breaks.append(s)
            since += s.seconds
        steps = with_breaks

    return Plan(
        steps=tuple(steps),
        budget_s=budget,
        review_share=review_share,
        new_targets=frozenset(
            t for s in steps if s.role == "lesson" and s.card for t in s.card.new_targets
        ),
        deferred=tuple(c.item_id for c in deferred),
    )


def target_of(memory_items: Sequence[str], fallback: str) -> str:
    """The syllabus target of an item: its first memory item without the aspect."""
    for m in memory_items:
        return m.rpartition(".")[0] or m
    return fallback


def expected_seconds(median_rt_ms: float) -> float:
    return median_rt_ms / 1000 + FEEDBACK_S


__all__ = [
    "Backlog",
    "Card",
    "Plan",
    "Request",
    "Review",
    "Step",
    "TierGate",
    "arrange",
    "backlog",
    "compose",
    "expected_seconds",
    "modality",
    "new_cap_per_day",
    "split",
    "target_of",
    "tier_gate",
    "violations",
]
