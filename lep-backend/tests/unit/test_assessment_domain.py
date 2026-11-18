"""Rubrics, rater agreement, BKT and the four-condition level award (backend brief Phase 7)."""

from __future__ import annotations

import math
import statistics

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.domain import bkt
from app.domain.level_award import (
    FRAGILE_MESSAGE,
    ExamResult,
    LevelEvidence,
    Production,
    evaluate_level_award,
    exam_passed,
)
from app.domain.rubric import (
    CRITERIA,
    Calibration,
    CriterionScore,
    RubricInvalid,
    is_borderline,
    may_certify,
    meets_level,
    overall_band,
    quadratic_weighted_kappa,
    rate,
)

# ------------------------------------------------------------------- the median rule


def test_a_6_6_6_6_2_profile_does_not_certify_at_band_6() -> None:
    assert overall_band([6, 6, 6, 6, 2]) == 3
    assert not meets_level(overall_band([6, 6, 6, 6, 2]), "C2")


def test_rich_vocabulary_and_unintelligible_pronunciation_is_not_c1() -> None:
    # speaking: range 5.5, accuracy 5, fluency 5, interaction 5, coherence 5, phonology 2
    overall = overall_band([5.5, 5, 5, 5, 5, 2])
    assert overall == 3
    assert not meets_level(overall, "C1")


def test_median_not_mean() -> None:
    # mean would be 4.2; the median is 4
    assert overall_band([4, 4, 4, 3, 6]) == 4
    # one criterion a single band low does not cap
    assert overall_band([5, 5, 5, 5, 4]) == 5


@given(st.lists(st.sampled_from([1 + k / 2 for k in range(11)]), min_size=4, max_size=6))
def test_the_overall_never_exceeds_the_median_nor_lowest_plus_one_when_capped(
    bands: list[float],
) -> None:
    overall = overall_band(bands)
    assert 1 <= overall <= 6
    assert overall * 2 == int(overall * 2)
    median = math.floor(statistics.median(bands) * 2) / 2
    assert overall <= median
    if median - min(bands) >= 2:
        assert overall <= min(bands) + 1


def _scores(
    kind: str, band: float, evidence: tuple[str, ...] = ("I went to the market.",)
) -> list[CriterionScore]:
    return [CriterionScore(c, band, evidence) for c in CRITERIA[kind]]


def test_a_number_with_no_evidence_fails_validation() -> None:
    with pytest.raises(RubricInvalid):
        rate("writing", _scores("writing", 4, ()))
    with pytest.raises(RubricInvalid):
        rate("writing", _scores("writing", 4, ("   ",)))
    with pytest.raises(RubricInvalid):
        rate("writing", _scores("writing", 4.25))
    with pytest.raises(RubricInvalid):
        rate("writing", _scores("writing", 4)[:4])
    assert rate("speaking", _scores("speaking", 3)).overall == 3


def test_borderline_is_within_5_percent_of_the_boundary() -> None:
    assert is_borderline(3.0, "B1")
    assert is_borderline(3.0 + 0.25, "B1")
    assert not is_borderline(3.5, "B1")
    assert not is_borderline(2.5, "B1")


# ------------------------------------------------------------------- the κ gate


def test_quadratic_weighted_kappa() -> None:
    assert quadratic_weighted_kappa([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]) == pytest.approx(1.0)
    assert quadratic_weighted_kappa([1, 2, 3, 4, 5, 6], [6, 5, 4, 3, 2, 1]) < 0
    near = quadratic_weighted_kappa([2, 3, 3, 4, 5, 5, 6, 2], [2, 3, 3.5, 4, 5, 4.5, 6, 2])
    assert 0.9 < near < 1.0


def test_a_rater_below_kappa_0_75_cannot_certify() -> None:
    cal = {
        ("llm-w-1", "B1", "writing"): Calibration("llm-w-1", "B1", "writing", 0.74, 200),
        ("llm-w-1", "B2", "writing"): Calibration("llm-w-1", "B2", "writing", 0.81, 200),
    }
    assert may_certify(cal, "llm-w-1", "B1", "writing") is False
    assert may_certify(cal, "llm-w-1", "B2", "writing") is True
    assert may_certify(cal, "llm-w-1", "B2.1", "writing") is True
    assert may_certify(cal, "llm-w-1", "C1", "writing") is False  # never calibrated
    assert may_certify(cal, "llm-w-1", "B2", "speaking") is False


# ------------------------------------------------------------------- the level award


def _passing(level: str = "B1", **over: object) -> LevelEvidence:
    values: dict[str, object] = {
        "level": level,
        "syllabus_total": 200,
        "syllabus_passed": 196,
        "memory_total": 1000,
        "memory_retained": 900,
        "exam": ExamResult({"listening": 0.8, "reading": 0.85, "use_of_english": 0.78}),
        "production": {"writing": Production(3.5, 3.0), "speaking": Production(3.0, 3.0)},
    }
    values.update(over)
    return LevelEvidence(**values)  # type: ignore[arg-type]


def test_all_four_hold_and_each_is_reported_with_its_value() -> None:
    result = evaluate_level_award(_passing())
    assert result.awarded is True
    assert [c.name for c in result.conditions] == ["coverage", "retention", "exam", "production"]
    assert result.condition("coverage").value == pytest.approx(0.98)
    assert result.condition("retention").value == pytest.approx(0.90)
    assert result.condition("exam").value == pytest.approx((0.8 + 0.85 + 0.78) / 3, abs=1e-4)
    assert result.condition("production").value == 3.0
    assert result.message is None
    assert result.remediation == ()


def test_passing_the_exam_on_60_percent_retention_is_refused_with_the_honest_message() -> None:
    result = evaluate_level_award(_passing(memory_retained=600))
    assert result.awarded is False
    assert result.condition("exam").passed is True
    retention = result.condition("retention")
    assert retention.passed is False
    assert retention.value == pytest.approx(0.60)
    assert retention.threshold == 0.85
    assert "250 more memory items" in retention.shortfall
    assert result.message == FRAGILE_MESSAGE
    assert result.message == (
        "You passed the test, but a lot of this is still fragile. "
        "Let's consolidate for two weeks and then certify."
    )


def test_finishing_nodes_alone_awards_nothing() -> None:
    result = evaluate_level_award(_passing(exam=None, production={}))
    assert result.awarded is False
    assert result.condition("coverage").passed
    assert result.condition("retention").passed
    assert result.condition("exam").shortfall == "the level exam has not been taken"
    assert result.message is None


def test_one_weak_paper_fails_the_exam() -> None:
    weak = ExamResult({"listening": 0.95, "reading": 0.95, "use_of_english": 0.55})
    assert exam_passed("B1", weak)[0] is False
    result = evaluate_level_award(_passing(exam=weak))
    assert "use_of_english below 60%" in result.condition("exam").shortfall


def test_c2_needs_80_and_70() -> None:
    exam = ExamResult({"listening": 0.78, "reading": 0.80, "use_of_english": 0.80})
    assert exam_passed("C1", exam)[0] is True
    assert exam_passed("C2", exam)[0] is False
    assert exam_passed("C2", ExamResult({"a": 0.9, "b": 0.69, "c": 0.9}))[0] is False


def test_from_b1_production_needs_a_certifying_rater() -> None:
    no_second = {"writing": Production(3.5, None), "speaking": Production(3.0, None)}
    assert (
        evaluate_level_award(_passing("B1", production=no_second)).condition("production").passed
        is False
    )
    assert (
        "needs a certifying rater"
        in evaluate_level_award(_passing("B1", production=no_second))
        .condition("production")
        .shortfall
    )
    a2 = _passing(
        "A2", production={"writing": Production(2.0, None), "speaking": Production(2.5, None)}
    )
    assert evaluate_level_award(a2).condition("production").passed is True


def test_coverage_shortfall_counts_items() -> None:
    c = evaluate_level_award(_passing(syllabus_passed=180)).condition("coverage")
    assert c.passed is False
    assert c.shortfall == "10 more syllabus items to pass at tier 2"


# ------------------------------------------------------------------- BKT


def test_bkt_rises_with_right_answers_and_falls_with_wrong() -> None:
    p = bkt.DEFAULT_PARAMS.p_init
    up = bkt.update(p, True, "text")
    assert up > p
    assert bkt.update(up, False, "text") < up
    # a right answer on a 4-option choice is weaker evidence than a typed one
    assert bkt.update(p, True, "choice") < bkt.update(p, True, "text")


def test_bkt_reaches_ready_after_a_run_of_right_answers() -> None:
    # two right answers on a 4-option choice could be luck; eight are not
    assert not bkt.ready(bkt.trace([(True, "choice")] * 2))
    assert bkt.ready(bkt.trace([(True, "choice")] * 8))


@given(st.lists(st.tuples(st.booleans(), st.sampled_from(sorted(bkt.GUESS))), max_size=50))
def test_bkt_stays_a_probability(answers: list[tuple[bool, str]]) -> None:
    assert 0.0 <= bkt.trace(answers) <= 1.0


def test_kappa_on_a_set_that_cannot_tell_bands_apart_does_not_open_the_gate() -> None:
    assert quadratic_weighted_kappa([3, 3, 3, 3, 3], [3, 3, 3, 3, 3]) == 0.0
