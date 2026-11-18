"""Session composition (backend brief Phase 5): property tests over random learner states."""

from __future__ import annotations

import math
import random
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from app.domain.composer import (
    FIT_TOLERANCE,
    GUIDED_SHARE,
    PRODUCTION_TYPES,
    RECOVERY_ITEMS,
    WARMUP_MIN_P,
    Card,
    Request,
    Review,
    Step,
    _runs_ok,
    arrange,
    backlog,
    compose,
    new_cap_per_day,
    split,
    tier_gate,
    violations,
)

TYPES = (
    "mcq_word_from_definition",
    "type_from_l1",
    "dictation_word",
    "repeat_after",
    "gap_fill_bank",
    "tap_pairs",
    "speak_prompt",
    "error_correct",
    "listen_gist_mcq",
    "word_bank_build",
)


def _card(rng: random.Random, k: int, *, targets: int, new: bool = False) -> Card:
    target = f"lex.{rng.randrange(targets):05d}"
    return Card(
        item_id=f"item.{k:07d}",
        type_id=rng.choice(TYPES),
        target=target,
        memory_items=(f"{target}.recog",),
        seconds=rng.uniform(5, 25),
        new_targets=frozenset({target}) if new else frozenset(),
    )


def _state(seed: int) -> Request:
    """A random learner: some due items (some leeches), warm-up candidates and new material."""
    rng = random.Random(seed)
    targets = rng.choice((3, 8, 40, 200))
    reviews = [
        Review(
            # some reviewing exercises also touch a target never met (word games, dictations)
            card=_card(rng, k, targets=targets, new=rng.random() < 0.15),
            memory_item_id=f"m{k}",
            retrievability=rng.uniform(0.2, 0.9),
            stability=rng.uniform(0.1, 60),
            importance=rng.uniform(0.5, 1.5),
            leech=rng.random() < 0.1,
            in_current_level=rng.random() < 0.5,
        )
        for k in range(rng.randrange(0, 120))
    ]
    warm = [
        Review(
            card=_card(rng, 10_000 + k, targets=targets),
            memory_item_id=f"w{k}",
            retrievability=rng.uniform(0.9, 1.0),
            stability=50,
        )
        for k in range(rng.randrange(0, 6))
    ]
    lesson = [
        _card(rng, 20_000 + k, targets=targets, new=True) for k in range(rng.randrange(0, 40))
    ]
    close = {
        r.memory_item_id: _card(rng, 30_000 + k, targets=targets) for k, r in enumerate(reviews)
    }
    return Request(
        minutes=10,
        reviews=reviews,
        warmups=warm,
        lesson=lesson,
        new_allowance=rng.choice((0, 3, 15, 20)),
        close_cards=close,
    )


def _runs(cards: list[Card], key: object) -> int:
    best = run = 0
    prev: object = object()
    for c in cards:
        v = key(c)  # type: ignore[operator]
        run = run + 1 if v == prev else 1
        prev = v
        best = max(best, run)
    return best


def _rule_breaks(plan_steps: tuple[Step, ...]) -> list[tuple[str, str]]:
    """(role before, role at) for every position that breaks an interleaving rule."""
    steps = [s for s in plan_steps if s.card is not None]
    cards = [s.card for s in steps if s.card is not None]
    return [
        (steps[i - 1].role, steps[i].role)
        for i in range(1, len(cards))
        if not _runs_ok(cards[:i], cards[i])
    ]


@pytest.mark.parametrize("chunk", range(10))
def test_a_10_minute_session_never_breaks_an_interleaving_rule(chunk: int) -> None:
    """1,000 random learner states (in ten chunks so a failure names its seed range).

    The review block keeps every rule; the only place a rule may give way is where a lesson
    item is placed and no spare review fits before it — the new block keeps its authored order
    and is never dropped (docs/08 §5 step 4)."""
    for seed in range(chunk * 100, chunk * 100 + 100):
        req = _state(seed)
        plan = compose(req)
        for before, at in _rule_breaks(plan.steps):
            assert at == "lesson", f"seed {seed}: {before} -> {at}"
        # the new block keeps its syllabus order
        lesson_ids = [s.card.item_id for s in plan.steps if s.role == "lesson" and s.card]
        order = {c.item_id: k for k, c in enumerate(req.lesson)}
        assert lesson_ids == sorted(lesson_ids, key=order.__getitem__), f"seed {seed}"
        # fit: never more than T + 10 %
        assert plan.seconds <= req.minutes * 60 * (1 + FIT_TOLERANCE), f"seed {seed}"
        # the new-target cap holds for every card, reviews included
        assert len(plan.new_targets) <= req.new_allowance, f"seed {seed}"
        # leeches never take more than 5 % of the session
        leech_ids = {r.memory_item_id for r in req.reviews if r.leech}
        leech_s = sum(
            s.seconds
            for s in plan.steps
            if s.role in ("review", "close") and s.memory_item_id in leech_ids
        )
        assert leech_s <= req.minutes * 60 * 0.05 + 1e-9, f"seed {seed}"
        # one memory item is never reviewed twice in the body of a session
        reviewed = [s.memory_item_id for s in plan.steps if s.role in ("review", "warmup")]
        assert len(reviewed) == len(set(reviewed)), f"seed {seed}"


def test_the_review_block_alone_never_breaks_a_rule() -> None:
    for seed in range(300):
        plan = compose(_with(_state(seed), lesson=[]))
        assert violations(plan.cards) == [], f"seed {seed}"


def test_short_sessions_introduce_nothing() -> None:
    for seed in range(200):
        req = _state(seed)
        plan = compose(_with(req, minutes=5))
        assert plan.new_targets == frozenset()
        assert all(s.role != "lesson" for s in plan.steps)


def _with(req: Request, **over: object) -> Request:
    values = {f: getattr(req, f) for f in Request.__dataclass_fields__}
    values.update(over)
    return Request(**values)


def test_the_new_item_cap_is_a_hard_cap() -> None:
    rng = random.Random(7)
    lesson = [_card(rng, k, targets=10_000, new=True) for k in range(60)]
    for allowance in (0, 1, 5, 15, 20):
        plan = compose(Request(minutes=30, lesson=lesson, new_allowance=allowance))
        assert len(plan.new_targets) <= allowance
    plan = compose(Request(minutes=30, lesson=lesson, new_allowance=0))
    assert [s for s in plan.steps if s.role == "lesson"] == []


def test_daily_caps_by_level_and_the_backlog_switch() -> None:
    assert new_cap_per_day("A1.1") == 15
    assert new_cap_per_day("A2.2") == 15
    assert new_cap_per_day("B1.1") == 20
    assert new_cap_per_day("C2") == 20
    assert backlog(due=60, normal_per_day=20).new_allowed is True
    assert backlog(due=61, normal_per_day=20).new_allowed is False
    b = backlog(due=180, normal_per_day=20)
    assert b.queue_cap == 30
    assert b.days_left == 6  # "catching up: 6 days left"
    assert backlog(due=10, normal_per_day=20).days_left == 0


def test_budget_split() -> None:
    assert split(5) == (1.0, False)
    assert split(6) == (0.70, False)
    assert split(10) == (0.70, False)
    assert split(11) == (0.60, False)
    assert split(20) == (0.60, False)
    assert split(21) == (0.55, True)


def test_priority_orders_the_review_block() -> None:
    rng = random.Random(3)
    urgent = Review(
        _card(rng, 1, targets=100),
        "urgent",
        retrievability=0.2,
        stability=1,
        importance=1.5,
        in_current_level=True,
    )
    calm = Review(
        _card(rng, 2, targets=100), "calm", retrievability=0.85, stability=30, importance=0.5
    )
    # a minute only has room for one of them: the urgent one wins
    plan = compose(Request(minutes=1, reviews=[_with_seconds(calm, 40), _with_seconds(urgent, 40)]))
    assert next(s.memory_item_id for s in plan.steps if s.role == "review") == "urgent"


def _with_seconds(r: Review, seconds: float) -> Review:
    return Review(
        card=Card(r.card.item_id, r.card.type_id, r.card.target, r.card.memory_items, seconds),
        memory_item_id=r.memory_item_id,
        retrievability=r.retrievability,
        stability=r.stability,
        importance=r.importance,
        leech=r.leech,
        in_current_level=r.in_current_level,
    )


def test_warm_up_and_close() -> None:
    rng = random.Random(11)
    reviews = [
        Review(_card(rng, k, targets=500), f"m{k}", retrievability=0.5, stability=float(k + 1))
        for k in range(10)
    ]
    warm = [
        Review(_card(rng, 100 + k, targets=500), f"w{k}", retrievability=0.97, stability=40)
        for k in range(3)
    ]
    low = Review(_card(rng, 200, targets=500), "unsure", retrievability=0.9, stability=40)
    close = {
        r.memory_item_id: Card(
            f"alt.{r.memory_item_id}", "spelling_bee", r.card.target, r.card.memory_items, 6
        )
        for r in reviews
    }
    plan = compose(Request(minutes=10, reviews=reviews, warmups=[*warm, low], close_cards=close))
    roles = [s.role for s in plan.steps]
    assert roles[:2] == ["warmup", "warmup"]
    assert "unsure" not in [s.memory_item_id for s in plan.steps if s.role == "warmup"]  # p < 0.95
    assert roles[-1] == "close"
    closing = plan.steps[-1]
    reviewed = {s.memory_item_id: s for s in plan.steps if s.role == "review"}
    assert closing.memory_item_id in reviewed
    # the weakest reviewed item, through a different exercise
    weakest = min((r for r in reviews if r.memory_item_id in reviewed), key=lambda r: r.stability)
    assert closing.memory_item_id == weakest.memory_item_id
    assert closing.card is not None
    before = reviewed[weakest.memory_item_id].card
    assert before is not None
    assert closing.card.type_id != before.type_id


def test_long_sessions_get_a_break_every_12_minutes() -> None:
    rng = random.Random(5)
    reviews = [
        Review(_card(rng, k, targets=1_000), f"m{k}", retrievability=0.5, stability=3)
        for k in range(300)
    ]
    plan = compose(Request(minutes=30, reviews=reviews))
    breaks = [i for i, s in enumerate(plan.steps) if s.role == "break"]
    assert len(breaks) == 2
    assert all(s.seconds == 15 for s in plan.steps if s.role == "break")
    assert not any(s.role == "break" for s in compose(Request(minutes=20, reviews=reviews)).steps)


def test_unplaceable_cards_are_deferred_not_forced() -> None:
    same = [Card(f"i{k}", "type_from_l1", "lex.00001", ("lex.00001.recall",), 5) for k in range(6)]
    placed, left = arrange([], same)
    assert len(placed) == 2  # two of one type in a row, then nothing else can follow
    assert len(left) == 4
    assert violations(placed) == []


T2 = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)


def test_tier_3_is_refused_2_days_23_hours_after_tier_2_and_allowed_at_3_days_1_minute() -> None:
    done = {1: T2 - timedelta(days=1), 2: T2}
    early = tier_gate(3, done, T2 + timedelta(days=2, hours=23))
    assert early.allowed is False
    assert early.reason == "spacing"
    assert early.available_at == T2 + timedelta(days=3)
    assert tier_gate(3, done, T2 + timedelta(days=3, minutes=1)).allowed is True


def test_tier_order() -> None:
    assert tier_gate(1, {}, T2).allowed is True
    assert tier_gate(2, {}, T2).reason == "previous_tier"
    assert tier_gate(2, {1: T2}, T2).allowed is True
    assert tier_gate(3, {1: T2}, T2 + timedelta(days=10)).reason == "previous_tier"


# ------------------------------------------------------------------- regressions from review


def test_a_node_tier_is_played_whole_even_when_every_item_is_on_one_target() -> None:
    """A story tier 3: six items on one text. All six are offered, in order (none deferred)."""
    story = [
        Card(f"item.{k:07d}", "read_gist_mcq", "txt.00002", ("txt.00002.comp",), 20)
        for k in range(6)
    ]
    rng = random.Random(1)
    reviews = [
        Review(_card(rng, 100 + k, targets=400), f"m{k}", retrievability=0.5, stability=2)
        for k in range(3)
    ]
    plan = compose(Request(minutes=5, reviews=reviews, lesson=story, node_share=1.0))
    assert [s.card.item_id for s in plan.steps if s.role == "lesson" and s.card] == [
        c.item_id for c in story
    ]
    # the spare reviews break the runs where they can; the tier's time is the budget's floor
    assert plan.budget_s >= sum(c.seconds for c in story)
    assert plan.seconds <= plan.budget_s * (1 + FIT_TOLERANCE)


def test_review_cards_count_against_the_daily_new_cap() -> None:
    rng = random.Random(2)
    touching = [
        Review(_card(rng, k, targets=1_000, new=True), f"m{k}", retrievability=0.3, stability=1)
        for k in range(20)
    ]
    plan = compose(Request(minutes=15, reviews=touching, new_allowance=0))
    assert plan.new_targets == frozenset()
    assert all(not s.card.new_targets for s in plan.steps if s.card)
    capped = compose(Request(minutes=15, reviews=touching, new_allowance=3))
    assert len(capped.new_targets) <= 3


def test_the_close_is_never_a_leech_and_introduces_nothing() -> None:
    rng = random.Random(4)
    leech = Review(
        _card(rng, 1, targets=500), "leechy", retrievability=0.3, stability=0.5, leech=True
    )
    calm = Review(_card(rng, 2, targets=500), "calm", retrievability=0.6, stability=3)
    close = {
        "leechy": Card("alt.leechy", "spelling_bee", leech.card.target, leech.card.memory_items, 6),
        "calm": Card("alt.calm", "spelling_bee", calm.card.target, calm.card.memory_items, 6),
    }
    plan = compose(Request(minutes=10, reviews=[leech, calm], close_cards=close))
    closes = [s for s in plan.steps if s.role == "close"]
    assert all(s.memory_item_id != "leechy" for s in closes)


def test_tier_gates_follow_the_tiers_a_node_has() -> None:
    now = T2 + timedelta(days=1)
    # story nodes with only tiers 2 and 3: tier 2 is the entry point
    assert tier_gate(2, {}, now, populated=(2, 3)).allowed is True
    assert tier_gate(3, {}, now, populated=(2, 3)).reason == "previous_tier"
    # a node with only tier 3 is open
    assert tier_gate(3, {}, now, populated=(3,)).allowed is True
    # tiers 1 and 3 only: tier 3 needs tier 1, and there is no tier-2 spacing to wait for
    assert tier_gate(3, {1: now}, now, populated=(1, 3)).allowed is True
    # a test-out records tier 2 without tier 1: tier 2 may be replayed, tier 3 waits 3 days
    tested = {2: T2}
    assert tier_gate(2, tested, now).allowed is True
    early = tier_gate(3, tested, now)
    assert early.reason == "spacing"
    assert early.available_at == T2 + timedelta(days=3)
    # a tier already passed may always be replayed
    assert tier_gate(3, {1: T2, 2: T2, 3: now}, now).allowed is True


# ------------------------------------------------------------------- phases and recovery


@pytest.mark.parametrize("chunk", range(4))
def test_every_step_carries_its_phase_in_the_session_shape(chunk: int) -> None:
    """docs/07 §3.2 on 400 random states: the role's own phase, and a lesson item is production
    when it is speaking or writing, else guided for the first 60 % of the practice items."""
    roles = {"warmup": "warmup", "review": "review", "close": "close", "break": "break"}
    for seed in range(chunk * 100, chunk * 100 + 100):
        req = _state(seed)
        plan = compose(req)
        lesson = [s for s in plan.steps if s.role == "lesson"]
        practice = [s for s in lesson if s.card and s.card.type_id not in PRODUCTION_TYPES]
        for s in plan.steps:
            if s.role != "lesson":
                assert s.phase == roles[s.role], f"seed {seed}"
            elif s.card and s.card.type_id in PRODUCTION_TYPES:
                assert s.phase == "production", f"seed {seed}"
        phases = [s.phase for s in practice]
        guided = phases.count("guided")
        assert guided == math.ceil(len(practice) * GUIDED_SHARE), f"seed {seed}"
        assert phases == ["guided"] * guided + ["integration"] * (len(phases) - guided)
        assert "new_input" not in {s.phase for s in plan.steps}, "presented, never tested"


@pytest.mark.parametrize("chunk", range(4))
def test_recovery_items_are_near_certain_new_to_the_plan_and_varied(chunk: int) -> None:
    for seed in range(chunk * 100, chunk * 100 + 100):
        rng = random.Random(10_000 + seed)
        req = _state(seed)
        candidates = [
            Review(
                card=_card(rng, 40_000 + k, targets=50, new=rng.random() < 0.2),
                memory_item_id=rng.choice((f"r{k}", f"m{k}", f"w{k}")),
                retrievability=rng.uniform(0.85, 1.0),
                stability=40,
            )
            for k in range(rng.randrange(0, 12))
        ]
        plan = compose(replace(req, recovery=candidates))
        assert len(plan.recovery) <= RECOVERY_ITEMS
        in_plan = {s.card.item_id for s in plan.steps if s.card}
        memory = {s.memory_item_id for s in plan.steps if s.memory_item_id}
        memory |= {m for s in plan.steps if s.card for m in s.card.memory_items}
        by_id = {c.memory_item_id: c for c in candidates}
        types = [s.card.type_id for s in plan.recovery if s.card]
        assert len(set(types)) == len(types), f"seed {seed}: one of each type"
        for s in plan.recovery:
            assert s.card is not None
            assert s.memory_item_id is not None
            assert (s.role, s.phase) == ("recovery", "integration")
            assert s.card.item_id not in in_plan, f"seed {seed}"
            assert s.memory_item_id not in memory, f"seed {seed}"
            assert not s.card.new_targets, f"seed {seed}: a recovery item introduces nothing"
            assert by_id[s.memory_item_id].retrievability >= WARMUP_MIN_P
        assert plan.seconds == sum(s.seconds for s in plan.steps), "not part of the time"


def test_recovery_prefers_the_surest_items() -> None:
    def card(k: int, type_id: str) -> Card:
        return Card(f"item.{k}", type_id, f"lex.{k}", (f"lex.{k}.recog",), 8.0)

    sure = Review(card(1, "mcq_word_from_definition"), "lex.1.recog", 0.99, 40)
    surer = Review(card(2, "odd_one_out"), "lex.2.recog", 0.995, 40)
    same_type = Review(card(3, "odd_one_out"), "lex.3.recog", 0.999, 40)
    shaky = Review(card(4, "tap_pairs"), "lex.4.recog", 0.90, 40)
    plan = compose(Request(minutes=10, recovery=[sure, surer, same_type, shaky]))
    assert [s.memory_item_id for s in plan.recovery] == ["lex.3.recog", "lex.1.recog"]


def test_recovery_never_asks_about_anything_the_plan_asks_about() -> None:
    """An item over several memory items is checked on all of them, not only its own."""
    weak = Card("item.w", "type_from_l1", "lex.2", ("lex.2.recog",), 8.0)
    planned = Review(weak, "lex.2.recog", 0.4, 1.0)
    # near-certain on lex.1, but the same odd-one-out also tests lex.2, which the plan reviews
    overlapping = Card(
        "item.o", "odd_one_out", "lex.1", ("lex.1.recog", "lex.2.recog", "lex.3.recog"), 8.0
    )
    clean = Card("item.c", "mcq_word_from_definition", "lex.4", ("lex.4.recog",), 8.0)
    plan = compose(
        Request(
            minutes=10,
            reviews=[planned],
            recovery=[
                Review(overlapping, "lex.1.recog", 0.999, 60),
                Review(clean, "lex.4.recog", 0.98, 60),
            ],
        )
    )
    assert [s.card.item_id for s in plan.recovery if s.card] == ["item.c"]


def test_old_plans_get_their_phases_by_the_same_rule() -> None:
    from app.domain.composer import phases_of

    steps = [
        ("warmup", "odd_one_out"),
        ("review", "type_from_l1"),
        ("lesson", "mcq_word_from_definition"),
        ("lesson", "gap_fill_bank"),
        ("lesson", "speak_prompt"),
        ("lesson", "tap_pairs"),
        ("break", None),
        ("close", "spelling_bee"),
    ]
    assert phases_of(steps) == [
        "warmup",
        "review",
        "guided",
        "guided",
        "production",
        "integration",
        "break",
        "close",
    ]
