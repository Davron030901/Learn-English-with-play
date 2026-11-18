"""Accessibility profiles (docs/00 §6): which exercise types each profile is shown, and how."""

from __future__ import annotations

from app.config import DEFAULT_CONTENT_DIR
from app.content.catalog import load_catalog_cached
from app.domain.accessibility import (
    EXCLUDED_WITHOUT_AUDIO,
    LIST_ROUTE_WITHOUT_VISION,
    NO_PROFILE,
    TEXT_ROUTE_WITHOUT_AUDIO,
    A11yProfile,
    degraded,
    preferred,
    presentable,
)
from app.domain.grading import FAMILY

NO_AUDIO = A11yProfile(no_audio=True)
NO_VISION = A11yProfile(no_vision=True)


def test_the_tables_name_real_exercise_types() -> None:
    known = set(FAMILY)
    assert known >= EXCLUDED_WITHOUT_AUDIO | TEXT_ROUTE_WITHOUT_AUDIO | LIST_ROUTE_WITHOUT_VISION
    assert not EXCLUDED_WITHOUT_AUDIO & TEXT_ROUTE_WITHOUT_AUDIO


def test_only_sound_only_types_are_ever_excluded() -> None:
    for type_id in FAMILY:
        assert presentable(type_id, NO_PROFILE)
        assert presentable(type_id, NO_VISION), "nothing is excluded without vision"
        assert presentable(type_id, NO_AUDIO) is (type_id not in EXCLUDED_WITHOUT_AUDIO)
        assert not degraded(type_id, NO_PROFILE)


def test_preferred_puts_full_routes_first_and_keeps_each_groups_order() -> None:
    types = ["dictation_word", "minimal_pair_discrimination", "type_from_l1", "memory_match"]
    assert preferred(types, str, NO_PROFILE) == types
    assert preferred(types, str, NO_AUDIO) == ["type_from_l1", "memory_match", "dictation_word"]
    assert preferred(types, str, NO_VISION) == [
        "dictation_word",
        "minimal_pair_discrimination",
        "type_from_l1",
        "memory_match",
    ]


def test_no_node_tier_is_left_with_nothing_to_show() -> None:
    """docs/00 §6: no exercise type is the only route — every node-tier keeps items a learner
    who cannot hear can be shown, so every tier can still be passed."""
    catalog = load_catalog_cached(DEFAULT_CONTENT_DIR)
    for node in catalog.nodes.values():
        for tier, ids in node.tiers.items():
            if ids:
                shown = [i for i in ids if presentable(catalog.items[i].type_id, NO_AUDIO)]
                assert shown, (node.id, tier)


class _Item:
    def __init__(self, type_id: str) -> None:
        self.type_id = type_id


class _Catalog:
    def __init__(self, types: dict[str, str]) -> None:
        self.items = {i: _Item(t) for i, t in types.items()}


def test_a_full_route_wins_even_when_a_degraded_one_suits_the_state_better() -> None:
    from app.services.progress import choose_item

    # a gap-fill (full) and a dictation (degraded without audio) review the same memory item;
    # the state's families prefer "text", which only the dictation is
    catalog = _Catalog({"bank": "gap_fill_bank", "dict": "dictation_sentence"})
    families = ("speak", "text", "bank")
    assert choose_item(["dict", "bank"], catalog, families, set(), NO_PROFILE) == "dict"  # type: ignore[arg-type]
    assert choose_item(["dict", "bank"], catalog, families, set(), NO_AUDIO) == "bank"  # type: ignore[arg-type]
    # the full route was the type used last time: still the full route, not the degraded one
    assert (
        choose_item(["dict", "bank"], catalog, families, {"gap_fill_bank"}, NO_AUDIO) == "bank"  # type: ignore[arg-type]
    )
    # with only degraded routes, a degraded one is used
    assert choose_item(["dict"], catalog, families, set(), NO_AUDIO) == "dict"  # type: ignore[arg-type]
    # strict families (the recovery's recognition items): degraded only if no full one fits
    race = _Catalog({"race": "word_race", "bins": "sort_bins", "mcq": "odd_one_out"})
    assert (
        choose_item(["race", "bins"], race, ("choice",), set(), NO_VISION, strict=True) is None  # type: ignore[arg-type]
    )
    assert (
        choose_item(["race", "mcq"], race, ("choice",), set(), NO_VISION, strict=True) == "mcq"  # type: ignore[arg-type]
    )
