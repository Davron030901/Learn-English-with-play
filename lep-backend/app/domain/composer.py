"""Session composition (docs/08 §5, §4.3, §7; backend brief §6.6–6.8). Pure: no I/O.

Given what the scheduler knows — the due memory items with their retrievability, some well-known
items for a warm-up, and the material of a node-tier or the next new items — and a requested
length in minutes, build the ordered list of exercises for one session:

1. **Budget.** T ≤ 5 min is all review (never introduce with no time to consolidate); 6–10 is
   70 % review / 30 % new; 11–20 is 60 / 40; above 20 is 55 / 45 with a 15 s break every 12 min.
   Time one block cannot use flows to the other, except into "new" at T ≤ 5.
2. **Review block**, most urgent first: ``(1 - R) × importance × (1 + 0.3·leech) × (1 + 0.2·in
   current level)``. Leeches never take more than 5 % of the session's time (docs/08 §7).
3. **New block**, in syllabus order (docs/08 §5 step 4), capped by the day's allowance of new
   targets (15 a day at A1–A2, 20 at B1+, none while the backlog is over 3× a normal day). Every
   card that would introduce a target — a review card included — counts against the allowance.
4. **Interleaving** of the review block (docs/08 §5 step 3), as hard rules: at most 3 consecutive
   items on one target, at most 2 consecutive of one exercise type, at most 3 consecutive of one
   modality, never the same item twice running — and the modality rotates (read → listen → type →
   speak) whenever the next pick allows it. A review that no position can take is left out and
   reported. The new block keeps its authored order and is **never dropped**: where a lesson item
   would break a rule, a review that was left out is used as a spacer if one fits; otherwise the
   lesson item follows the one before it, as the content was written.
5. **Warm-up** — up to 2 items predicted at p(correct) ≥ 0.95 — and **close** — the reviewed
   memory item with the lowest stability, through a different exercise (the recency effect).
6. **Fit**: Σ expected seconds (the learner's median response time per exercise family, plus
   time to read the feedback) stays within T + 10 %. A node-tier is played whole, so a node
   session's budget is never below the tier's own time; reviews only fill what is left.
7. **Phases** (docs/07 §3.2): every step is labelled with the part of the mandatory session shape
   it belongs to — warm-up, review, guided practice (the first 60 % of the lesson's practice
   items), integration (the rest), production (speaking and free writing), close. NEW INPUT is
   presented, never tested, so no item carries it: the app shows the new words and grammar
   before the first lesson item.
8. **Recovery**: up to two items the learner is almost sure to get right (p ≥ 0.95, a different
   exercise type each, nothing new, nothing already in the plan) travel with the plan. The app
   plays one before CLOSE when the last answer was wrong — a session never ends on a failure
   (docs/07 §3.2) — and none otherwise, so they are not part of the session's time.

Node tiers (docs/08 §4.3): the lowest tier a node has is always open; each later one needs the
tier before it; tier 3 opens only **3 days** after tier 2 — structural spacing, enforced here and
in the award pipeline. A node without a tier 2 has no tier-2 spacing to wait for.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
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
RECOVERY_ITEMS: Final = 2
#: the share of a lesson's practice items that is guided practice; the rest is integration
GUIDED_SHARE: Final = 0.6
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


#: speaking and free writing: the PRODUCTION phase of docs/07 §3.2
PRODUCTION_TYPES: Final = frozenset(
    {
        "repeat_after",
        "speak_prompt",
        "read_aloud",
        "speak_roleplay",
        "speak_retell",
        "write_sentence",
    }
)


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
    #: candidates for the recovery items: well-known memory items through a recognition exercise
    recovery: Sequence[Review] = ()


# ------------------------------------------------------------------------- output

Role = Literal["warmup", "review", "lesson", "close", "break", "recovery"]
#: docs/07 §3.2; ``break`` is the rest screen, which belongs to no phase
Phase = Literal[
    "warmup", "review", "new_input", "guided", "integration", "production", "close", "break"
]

#: the phase of every role but ``lesson``, whose phase depends on its place in the lesson
ROLE_PHASE: Final[dict[str, Phase]] = {
    "warmup": "warmup",
    "review": "review",
    "close": "close",
    "break": "break",
    "recovery": "integration",
}


@dataclass(frozen=True, slots=True)
class Step:
    role: Role
    card: Card | None
    seconds: float
    memory_item_id: str | None = None
    phase: Phase = "review"


@dataclass(frozen=True, slots=True)
class Plan:
    steps: tuple[Step, ...]
    budget_s: float
    review_share: float
    new_targets: frozenset[str]
    #: reviews chosen but left out because no position kept every interleaving rule
    deferred: tuple[str, ...]
    #: held back for the app to play before CLOSE when the last answer was wrong
    recovery: tuple[Step, ...] = ()

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


def tier_gate(
    tier: int,
    completed: Mapping[int, datetime],
    now: datetime,
    populated: Iterable[int] = (1, 2, 3),
) -> TierGate:
    """docs/08 §4.3 over the tiers the node actually has.

    The lowest populated tier is always open. A later tier needs the populated tier before it to
    be completed — or any tier from there up (a test-out records tier 2 without tier 1, and a
    tier already passed may always be replayed). Tier 3 opens 3 days after tier 2 was completed;
    a node with no tier 2 has no such wait.
    """
    tiers = sorted(set(populated))
    if not tiers or tier <= tiers[0]:
        return TierGate(True, "ok")
    if any(t >= tier for t in completed):
        return TierGate(True, "ok")  # passed already: replaying it is practice
    before = max(t for t in tiers if t < tier)
    if not any(t >= before for t in completed):
        return TierGate(False, "previous_tier")
    if tier == 3 and before == 2:
        t2 = completed.get(2)
        if t2 is not None and now < t2 + TIER3_SPACING:
            return TierGate(False, "spacing", t2 + TIER3_SPACING)
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


class _Allowance:
    """The day's remaining new targets, shared by every card of the session."""

    def __init__(self, remaining: int) -> None:
        self.remaining = max(0, remaining)
        self.introduced: set[str] = set()

    def fits(self, card: Card) -> bool:
        return len(card.new_targets - self.introduced) <= self.remaining

    def take(self, card: Card) -> None:
        fresh = card.new_targets - self.introduced
        self.remaining -= len(fresh)
        self.introduced |= fresh


def _take_reviews(
    reviews: Iterable[Review],
    budget_s: float,
    leech_cap_s: float,
    taken: set[str],
    allowance: _Allowance,
) -> list[Review]:
    """Most urgent first, within the time, the leech share and the day's new targets."""
    out: list[Review] = []
    items: set[str] = set()
    used = leech_s = 0.0
    for r in sorted(reviews, key=lambda r: (-r.priority, r.memory_item_id)):
        if r.memory_item_id in taken or r.card.item_id in items:
            continue
        if used + r.card.seconds > budget_s or not allowance.fits(r.card):
            continue
        if r.leech:
            if leech_s + r.card.seconds > leech_cap_s:
                continue
            leech_s += r.card.seconds
        out.append(r)
        allowance.take(r.card)
        items.add(r.card.item_id)
        used += r.card.seconds
        taken.add(r.memory_item_id)
    return out


def _take_lesson(
    cards: Iterable[Card], budget_s: float, allowance: _Allowance | None
) -> list[Card]:
    """New material in syllabus order. ``allowance`` None: a node-tier, played whole."""
    out: list[Card] = []
    used = 0.0
    for c in cards:
        if allowance is not None:
            if used + c.seconds > budget_s or not allowance.fits(c):
                continue
            allowance.take(c)
        out.append(c)
        used += c.seconds
    return out


def _place_lesson(
    seq: list[Card], lesson: Sequence[Card], spares: list[Card]
) -> tuple[list[Card], set[int]]:
    """The new block in its authored order, every card placed; a spare review breaks a run
    where one fits. Returns the cards added and the ids of the spares used."""
    added: list[Card] = []
    used: set[int] = set()
    for card in lesson:
        if not _runs_ok(seq, card):
            for k, spare in enumerate(spares):
                if _runs_ok(seq, spare) and _runs_ok([*seq, spare], card):
                    seq.append(spare)
                    added.append(spare)
                    used.add(id(spare))
                    spares.pop(k)
                    break
        seq.append(card)
        added.append(card)
    return added, used


def compose(req: Request) -> Plan:
    node = req.node_share is not None
    requested = max(1, req.minutes) * 60.0
    review_share, breaks = split(req.minutes)
    if node:
        review_share = 1.0 - (req.node_share or 0.0)

    # 1. warm-up: up to two items the learner is almost sure to get right, introducing nothing
    taken: set[str] = set()
    warm_cards: list[Review] = []
    for w in sorted(req.warmups, key=lambda w: (-w.retrievability, w.memory_item_id)):
        if len(warm_cards) == WARMUP_ITEMS:
            break
        if w.retrievability < WARMUP_MIN_P or w.memory_item_id in taken or w.card.new_targets:
            continue
        if not _runs_ok([x.card for x in warm_cards], w.card):
            continue
        warm_cards.append(w)
        taken.add(w.memory_item_id)
    warm_s = sum(w.card.seconds for w in warm_cards)

    # 2. the lesson: a node-tier whole (its time sets the floor of the budget); new material
    #    for free practice within its share and the day's allowance
    lesson_alloc = _Allowance(req.new_allowance)
    if node:
        lesson = _take_lesson(req.lesson, math.inf, None)
        for c in lesson:
            lesson_alloc.introduced |= c.new_targets  # the caller already counted these
        budget = max(requested, warm_s + sum(c.seconds for c in lesson))
    else:
        budget = requested
        lesson_budget = 0.0 if req.minutes <= 5 else budget * (1 - review_share)
        lesson = _take_lesson(req.lesson, lesson_budget, lesson_alloc)
    lesson_s = sum(c.seconds for c in lesson)
    ceiling = budget * (1 + FIT_TOLERANCE)

    # 3. reviews fill the time that is left, most urgent first, and may only introduce targets
    #    within what the allowance still holds after the lesson
    # nothing new at all in a session too short to consolidate it (T ≤ 5)
    review_alloc = _Allowance(0 if (not node and req.minutes <= 5) else lesson_alloc.remaining)
    review_alloc.introduced = set(lesson_alloc.introduced)
    reviews = _take_reviews(
        req.reviews,
        max(0.0, budget - warm_s - lesson_s),
        budget * LEECH_TIME_SHARE,
        taken,
        review_alloc,
    )
    if not node and req.lesson and req.minutes > 5:
        # time the reviews could not use flows back to new material, within the allowance
        spare_time = max(0.0, budget - warm_s - sum(r.card.seconds for r in reviews))
        if spare_time > lesson_s:
            review_new = review_alloc.introduced - lesson_alloc.introduced
            regrow = _Allowance(req.new_allowance - len(review_new))
            regrow.introduced = set(review_new)
            lesson = _take_lesson(req.lesson, spare_time, regrow)

    # 4. order: warm-up; the review block interleaved under the hard rules; the new block in
    #    syllabus order, with left-over reviews as spacers where a run would be too long
    seq: list[Card] = [w.card for w in warm_cards]
    review_placed, review_left = arrange(seq, [r.card for r in reviews])
    seq.extend(review_placed)
    lesson_added, spares_used = _place_lesson(seq, lesson, review_left)
    by_card = {id(r.card): r for r in reviews}
    lesson_ids = {id(c) for c in lesson}

    steps: list[Step] = [
        Step("warmup", w.card, w.card.seconds, w.memory_item_id) for w in warm_cards
    ]
    for c in [*review_placed, *lesson_added]:
        rv = by_card.get(id(c))
        if id(c) in lesson_ids:
            steps.append(Step("lesson", c, c.seconds))
        elif rv is not None:
            steps.append(Step("review", c, c.seconds, rv.memory_item_id))
    deferred = [c for c in review_left if id(c) not in spares_used]

    # 5. close: the weakest memory item just reviewed — never a leech, so leeches stay within
    #    their share — through a different exercise that introduces nothing new
    sequence = [s.card for s in steps if s.card is not None]
    total = sum(s.seconds for s in steps)
    placed_reviews = [by_card[id(s.card)] for s in steps if s.role == "review" and s.card]
    for r in sorted(placed_reviews, key=lambda r: (r.stability, r.memory_item_id)):
        alt = req.close_cards.get(r.memory_item_id)
        if r.leech or alt is None or alt.new_targets:
            continue
        if alt.type_id == r.card.type_id or alt.item_id == r.card.item_id:
            continue
        if total + alt.seconds > ceiling or not _runs_ok(sequence, alt):
            continue
        steps.append(Step("close", alt, alt.seconds, r.memory_item_id))
        sequence.append(alt)
        total += alt.seconds
        break

    # 6. long sessions: a 15-second break every 12 minutes of work
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

    # 7. phases (docs/07 §3.2)
    steps = label_phases(steps)

    # 8. recovery: held back, played only if the session would otherwise end on a failure
    return Plan(
        steps=tuple(steps),
        budget_s=budget,
        review_share=review_share,
        new_targets=frozenset(t for s in steps if s.card for t in s.card.new_targets),
        deferred=tuple(c.item_id for c in deferred),
        recovery=_recovery(req.recovery, steps),
    )


def phases_of(steps: Sequence[tuple[str, str | None]]) -> list[Phase]:
    """The docs/07 §3.2 phase of each ``(role, type_id)``: a lesson item is production when it
    is speaking or free writing, else guided practice for the first 60 % of the lesson's practice
    items and integration after them; every other role has its own."""
    practice = sum(
        1 for role, t in steps if role == "lesson" and t is not None and t not in PRODUCTION_TYPES
    )
    guided = math.ceil(practice * GUIDED_SHARE)
    seen = 0
    out: list[Phase] = []
    for role, t in steps:
        if role == "lesson" and t is not None:
            if t in PRODUCTION_TYPES:
                out.append("production")
            else:
                out.append("guided" if seen < guided else "integration")
                seen += 1
        else:
            out.append(ROLE_PHASE.get(role, "review"))
    return out


def label_phases(steps: Sequence[Step]) -> list[Step]:
    """Each step with its phase (``phases_of``)."""
    phases = phases_of([(s.role, s.card.type_id if s.card else None) for s in steps])
    return [replace(s, phase=p) for s, p in zip(steps, phases, strict=True)]


def _recovery(candidates: Iterable[Review], steps: Sequence[Step]) -> tuple[Step, ...]:
    """Up to two near-certain items, each a different exercise type, none in the plan."""
    items = {s.card.item_id for s in steps if s.card is not None}
    memory = {m for s in steps if s.card is not None for m in s.card.memory_items}
    memory |= {s.memory_item_id for s in steps if s.memory_item_id is not None}
    types: set[str] = set()
    out: list[Step] = []
    for r in sorted(candidates, key=lambda r: (-r.retrievability, r.memory_item_id)):
        if len(out) == RECOVERY_ITEMS:
            break
        card = r.card
        if r.retrievability < WARMUP_MIN_P or card.new_targets or card.type_id in types:
            continue
        # nothing the plan asks about: an item over several memory items is checked on all
        tests = {r.memory_item_id, *card.memory_items}
        if card.item_id in items or tests & memory:
            continue
        out.append(Step("recovery", card, card.seconds, r.memory_item_id, phase="integration"))
        items.add(card.item_id)
        memory |= tests
        types.add(card.type_id)
    return tuple(out)


def target_of(memory_items: Sequence[str], fallback: str) -> str:
    """The syllabus target of an item: its first memory item without the aspect."""
    for m in memory_items:
        return m.rpartition(".")[0] or m
    return fallback


def expected_seconds(median_rt_ms: float) -> float:
    return median_rt_ms / 1000 + FEEDBACK_S


__all__ = [
    "PRODUCTION_TYPES",
    "ROLE_PHASE",
    "Backlog",
    "Card",
    "Phase",
    "Plan",
    "Request",
    "Review",
    "Step",
    "TierGate",
    "arrange",
    "backlog",
    "compose",
    "expected_seconds",
    "label_phases",
    "modality",
    "phases_of",
    "new_cap_per_day",
    "split",
    "target_of",
    "tier_gate",
    "violations",
]
