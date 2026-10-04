"""Mastery states and the weakest-aspect rule (docs/08 §3, §4.1)."""

from __future__ import annotations

import pytest

from app.domain.mastery import (
    Aspect,
    ItemHistory,
    MasteryState,
    classify,
    lexeme_known,
    unlocked_aspects,
    weakest_stability,
)


@pytest.mark.parametrize(
    ("item", "state"),
    [
        (ItemHistory(None, None, 0), MasteryState.UNSEEN),
        (ItemHistory(0.5, 5.0, 1), MasteryState.LEARNING),
        (ItemHistory(1.0, 5.0, 2), MasteryState.YOUNG),
        (ItemHistory(21.0, 5.0, 4), MasteryState.RETAINED),
        (ItemHistory(180.0, 5.0, 6), MasteryState.DURABLE),
        (ItemHistory(365.0, 4.0, 8), MasteryState.RETIRED),
        (ItemHistory(365.0, 4.5, 8), MasteryState.DURABLE),
        (ItemHistory(4.9, 7.0, 6), MasteryState.LEECH),
        (ItemHistory(30.0, 7.0, 9, lapses_last_30_days=4), MasteryState.LEECH),
        (ItemHistory(30.0, 7.0, 9, suspended=True), MasteryState.SUSPENDED),
    ],
)
def test_states_follow_docs_08_section_4_1(item: ItemHistory, state: MasteryState) -> None:
    assert classify(item) is state


def test_lexeme_mastery_is_the_minimum_not_the_max_or_the_mean() -> None:
    # Recognition is durable, recall is weak: the max (200) and the mean (~108) would both
    # call this word known; the weakest aspect (8 days) says it is not.
    aspects = {Aspect.RECOG: 200.0, Aspect.AURAL: 116.0, Aspect.RECALL: 8.0}
    assert weakest_stability(aspects) == 8.0
    assert max(aspects.values()) >= 21
    assert sum(aspects.values()) / 3 >= 21
    assert lexeme_known(aspects) is False


def test_an_unseen_required_aspect_means_not_known() -> None:
    aspects: dict[Aspect, float | None] = {Aspect.RECOG: 60.0, Aspect.RECALL: None}
    assert weakest_stability(aspects) is None
    assert lexeme_known(aspects) is False
    assert lexeme_known({Aspect.RECOG: 60.0, Aspect.RECALL: 25.0}) is True


def test_aspects_unlock_in_the_documented_order() -> None:
    assert unlocked_aspects({}) == {Aspect.RECOG, Aspect.AURAL}
    assert Aspect.RECALL not in unlocked_aspects({Aspect.RECOG: 6.9})
    assert Aspect.RECALL in unlocked_aspects({Aspect.RECOG: 7.0})
    after_recall = unlocked_aspects({Aspect.RECOG: 30.0, Aspect.RECALL: 7.0})
    assert Aspect.SPELL in after_recall
    assert Aspect.PRODUCE not in after_recall
    assert Aspect.PRODUCE in unlocked_aspects({Aspect.RECOG: 30.0, Aspect.RECALL: 21.0})
