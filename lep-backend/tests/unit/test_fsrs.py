"""FSRS-6 (backend brief Phase 3): property tests, not just examples."""

from __future__ import annotations

import math
import random

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.domain.fsrs import (
    DEFAULT_WEIGHTS,
    FSRS6_DEFAULT_WEIGHTS,
    Grade,
    InvalidWeights,
    MemoryState,
    Weights,
    fuzz_unit,
    fuzzed_interval,
    grade_response,
    initial_difficulty,
    initial_stability,
    interval_days,
    next_difficulty,
    next_interval,
    retrievability,
    review,
    stability_after_lapse,
    stability_after_success,
    stability_same_day,
)

stabilities = st.floats(min_value=0.01, max_value=10_000, allow_nan=False, allow_infinity=False)
difficulties = st.floats(min_value=1.0, max_value=10.0, allow_nan=False)
retrievabilities = st.floats(min_value=0.0, max_value=1.0, allow_nan=False)
grades = st.sampled_from(list(Grade))


@st.composite
def weight_vectors(draw: st.DrawFn) -> Weights:
    """Plausible parameter vectors around the defaults (each scaled by 0.5–1.5)."""
    scaled = [
        w * draw(st.floats(min_value=0.5, max_value=1.5, allow_nan=False))
        for w in FSRS6_DEFAULT_WEIGHTS
    ]
    scaled[7] = min(scaled[7], 1.0)
    return Weights.of(scaled)


# ------------------------------------------------------------------- the curve


@given(stabilities, weight_vectors())
def test_stability_is_the_interval_to_ninety_percent_recall(s: float, w: Weights) -> None:
    assert retrievability(s, s, w) == pytest.approx(0.90, abs=1e-9)


@given(stabilities, st.floats(min_value=0.5, max_value=0.99), weight_vectors())
def test_the_interval_inverts_the_curve(s: float, rd: float, w: Weights) -> None:
    t = interval_days(s, rd, w)
    assert retrievability(t, s, w) == pytest.approx(rd, abs=1e-9)


@given(
    stabilities, st.floats(min_value=0, max_value=1_000), st.floats(min_value=0, max_value=1_000)
)
def test_recall_only_decays(s: float, t1: float, t2: float) -> None:
    early, late = sorted((t1, t2))
    assert retrievability(early, s) >= retrievability(late, s)
    assert retrievability(0, s) == 1.0


def test_higher_desired_retention_means_shorter_intervals() -> None:
    s = 30.0
    assert interval_days(s, 0.94) < interval_days(s, 0.90) < interval_days(s, 0.85)
    assert interval_days(s, 0.90) == pytest.approx(s)


# ------------------------------------------------------------------- initial state


def test_initial_state_follows_the_grade() -> None:
    stabs = [initial_stability(g) for g in Grade]
    assert stabs == list(FSRS6_DEFAULT_WEIGHTS[:4])
    diffs = [initial_difficulty(g) for g in Grade]
    assert diffs == sorted(diffs, reverse=True)
    assert all(1.0 <= d <= 10.0 for d in diffs)


# ------------------------------------------------------------------- invariants


@given(stabilities, difficulties, retrievabilities, weight_vectors())
def test_a_lapse_never_raises_stability(s: float, d: float, r: float, w: Weights) -> None:
    assert stability_after_lapse(s, d, r, w) <= s
    assert stability_after_lapse(s, d, r, w) > 0


@given(
    st.lists(st.tuples(grades, st.floats(min_value=0, max_value=400), st.booleans()), max_size=60)
)
@settings(max_examples=10_000, deadline=None)
def test_difficulty_stays_in_range_over_any_review_sequence(
    seq: list[tuple[Grade, float, bool]],
) -> None:
    state: MemoryState | None = None
    for g, elapsed, same_day in seq:
        state = review(state, g, elapsed, same_day=same_day)
        assert 1.0 <= state.difficulty <= 10.0
        assert state.stability > 0
        assert math.isfinite(state.stability)


@given(st.sampled_from([Grade.HARD, Grade.GOOD, Grade.EASY]), stabilities, retrievabilities)
def test_success_never_lowers_stability(g: Grade, s: float, r: float) -> None:
    assert stability_after_success(s, 5.0, r, g) >= s


@given(st.sampled_from([Grade.HARD, Grade.GOOD, Grade.EASY]), stabilities, st.floats(0.05, 0.95))
def test_harder_items_gain_less(g: Grade, s: float, r: float) -> None:
    easy_item = stability_after_success(s, 3.0, r, g) / s
    hard_item = stability_after_success(s, 8.0, r, g) / s
    assert hard_item <= easy_item


@given(st.sampled_from([Grade.HARD, Grade.GOOD, Grade.EASY]), st.floats(0.05, 0.95))
def test_memory_saturates_higher_stability_gains_less(g: Grade, r: float) -> None:
    weak = stability_after_success(2.0, 5.0, r, g) / 2.0
    strong = stability_after_success(200.0, 5.0, r, g) / 200.0
    assert strong <= weak


@given(st.sampled_from([Grade.HARD, Grade.GOOD, Grade.EASY]), stabilities)
def test_the_spacing_effect_almost_forgotten_gains_more(g: Grade, s: float) -> None:
    assert stability_after_success(s, 5.0, 0.6, g) >= stability_after_success(s, 5.0, 0.95, g)


def test_grades_order_the_gain_and_the_difficulty() -> None:
    s, d, r = 10.0, 5.0, 0.85
    hard, good, easy = (
        stability_after_success(s, d, r, g) for g in (Grade.HARD, Grade.GOOD, Grade.EASY)
    )
    assert hard < good < easy
    assert (
        next_difficulty(d, Grade.AGAIN)
        > next_difficulty(d, Grade.GOOD)
        > next_difficulty(d, Grade.EASY)
    )


@given(stabilities, st.sampled_from([Grade.GOOD, Grade.EASY]))
def test_a_correct_same_day_review_never_shrinks_stability(s: float, g: Grade) -> None:
    assert stability_same_day(s, g) >= s


def test_same_day_review_uses_the_short_term_update() -> None:
    state = MemoryState(stability=4.0, difficulty=5.0)
    same = review(state, Grade.GOOD, 0.2, same_day=True)
    later = review(state, Grade.GOOD, 0.2, same_day=False)
    assert same.stability == stability_same_day(4.0, Grade.GOOD)
    assert later.stability != same.stability


def test_review_is_deterministic() -> None:
    rng = random.Random(7)
    seq = [(rng.choice(list(Grade)), rng.uniform(0, 30)) for _ in range(200)]

    def run() -> MemoryState | None:
        state: MemoryState | None = None
        for g, t in seq:
            state = review(state, g, t)
        return state

    assert run() == run()


# ------------------------------------------------------------------- weights


@pytest.mark.parametrize(
    "bad",
    [
        FSRS6_DEFAULT_WEIGHTS[:20],
        (*FSRS6_DEFAULT_WEIGHTS[:20], 0.0),
        (*FSRS6_DEFAULT_WEIGHTS[:20], math.nan),
        (0.0, *FSRS6_DEFAULT_WEIGHTS[1:]),
    ],
)
def test_unusable_parameter_vectors_are_refused(bad: tuple[float, ...]) -> None:
    with pytest.raises(InvalidWeights):
        Weights.of(bad)


def test_the_default_vector_is_the_published_one() -> None:
    assert DEFAULT_WEIGHTS.w == FSRS6_DEFAULT_WEIGHTS
    assert len(FSRS6_DEFAULT_WEIGHTS) == 21


# ------------------------------------------------------------------- fuzz


def test_fuzz_is_deterministic_and_in_unit_range() -> None:
    a = fuzz_unit("learner", "lex.00001.recog", "3")
    assert a == fuzz_unit("learner", "lex.00001.recog", "3")
    assert a != fuzz_unit("learner", "lex.00001.recog", "4")
    assert 0.0 <= a < 1.0


@given(st.floats(min_value=0, max_value=30_000), st.floats(min_value=0, max_value=0.999999))
def test_fuzz_stays_within_five_percent_or_one_day(days: float, u: float) -> None:
    base = max(1, round(days))
    out = fuzzed_interval(days, u)
    assert out >= 1
    if base < 3:
        assert out == base
    else:
        assert abs(out - base) <= max(1, round(base * 0.05))


def test_fuzz_spreads_items_learned_together() -> None:
    outs = {fuzzed_interval(40.0, fuzz_unit("l", f"item{i}", "1")) for i in range(200)}
    assert len(outs) >= 4


def test_next_interval_matches_the_curve_without_fuzz() -> None:
    assert next_interval(MemoryState(30.0, 5.0)) == 30
    assert next_interval(MemoryState(0.2, 5.0)) == 1


# ------------------------------------------------------------------- grading a response


def test_grades_follow_docs_08_section_2_3() -> None:
    assert grade_response(correct=False) == Grade.AGAIN
    assert grade_response(correct=True, timed_out=True) == Grade.AGAIN
    assert grade_response(correct=True, hints_used=1) == Grade.HARD
    assert grade_response(correct=True, rt_ms=9_000, median_rt_ms=3_000) == Grade.HARD
    assert grade_response(correct=True, rt_ms=1_000, median_rt_ms=3_000) == Grade.EASY
    assert grade_response(correct=True, rt_ms=3_000, median_rt_ms=3_000) == Grade.GOOD
    assert grade_response(correct=True, marked_too_easy=True) == Grade.EASY
    assert grade_response(correct=True) == Grade.GOOD
