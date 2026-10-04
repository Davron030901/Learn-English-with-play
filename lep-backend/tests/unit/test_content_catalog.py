"""The course catalog (backend brief Phase 2): the real bundle, and bundles that must be refused."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

import pytest

from app.config import DEFAULT_CONTENT_DIR
from app.content.catalog import ContentCatalog, ContentError, load_catalog, load_catalog_cached
from app.content.memory_items import (
    Aspect,
    InvalidMemoryItemId,
    MemoryItemId,
    derive_memory_items,
)


@pytest.fixture(scope="module")
def catalog() -> ContentCatalog:
    return load_catalog_cached(DEFAULT_CONTENT_DIR)


# ------------------------------------------------------------------- the real bundle


def test_the_bundle_matches_the_build_figures(catalog: ContentCatalog) -> None:
    # backend brief §2.1, verified facts
    assert catalog.totals == {
        "sections": 10,
        "units": 168,
        "nodes": 1344,
        "node_tiers": 3019,
        "items": 37173,
        "lexemes": 5948,
        "stories": 168,
        "memory_items": 11791,
    }
    assert catalog.memory_item_refs == 48684


def test_derived_memory_items_reproduce_the_build_aspect_counts(catalog: ContentCatalog) -> None:
    counts = Counter(m.rsplit(".", 1)[1] for it in catalog.items.values() for m in it.memory_items)
    # backend brief §3.1
    assert counts == {
        "recog": 19418,
        "prod": 7832,
        "recall": 4417,
        "form": 3404,
        "judge": 3188,
        "disc": 3187,
        "ex01": 2730,
        "aural": 2106,
        "comp": 1472,
        "spell": 851,
        "choice": 79,
    }
    for it in catalog.items.values():
        for m in it.memory_items:
            MemoryItemId.parse(m)


def test_the_content_version_is_the_one_the_app_ships(catalog: ContentCatalog) -> None:
    generated = (
        Path(__file__).resolve().parents[3] / "lep-frontend/src/content/version.generated.ts"
    )
    if not generated.is_file():
        pytest.skip("the frontend is not checked out next to the backend")
    assert f'"{catalog.version}"' in generated.read_text(encoding="utf-8")


def test_levels_come_from_the_unit_never_the_item(catalog: ContentCatalog) -> None:
    item = catalog.items["item.0000001"]
    assert item.unit_id == "S01U01"
    assert item.cefr == "A1.1"
    c2 = next(i for i in catalog.items.values() if i.unit_id.startswith("S10"))
    assert c2.cefr == "C2"


def test_nodes_get_their_kind_from_their_position(catalog: ContentCatalog) -> None:
    kinds = [catalog.nodes[n].kind for n in catalog.units["S05U12"].node_ids]
    assert kinds == [
        "lesson",
        "lesson",
        "lesson",
        "story",
        "lesson",
        "speak",
        "immersion",
        "review",
    ]


def test_unit_detail_has_nodes_vocabulary_grammar_and_story(catalog: ContentCatalog) -> None:
    body = catalog.unit_json("S05U12")
    assert body is not None
    unit: dict[str, Any] = json.loads(body)
    assert unit["id"] == "S05U12"
    assert unit["cefr"] == "B1.1"
    assert len(unit["nodes"]) == 8
    assert unit["lexemes"]
    assert unit["grammar"]
    assert unit["story"]["id"].startswith("txt.")
    first = unit["nodes"][0]["tiers"]["1"][0]
    assert first["memory_items"]
    assert first["instruction_key"].startswith("instr.")
    assert catalog.unit_json("S99U99") is None


def test_known_defects_are_counted_not_hidden(catalog: ContentCatalog) -> None:
    # frontend DECISIONS C2: 380 of 906 stress_tap items' syllables do not spell the word
    assert catalog.defects["stress_syllables_do_not_spell_the_word"] == 380


# ------------------------------------------------------------------- memory items


def test_memory_item_ids_follow_the_build_convention() -> None:
    assert str(MemoryItemId.parse("lex.03421.recall")) == "lex.03421.recall"
    assert MemoryItemId.parse("G-107.form").aspect is Aspect.FORM
    assert MemoryItemId.parse("txt.00004.comp").syllabus_id == "txt.00004"
    for bad in ("gram.G-107.form", "lex.03421.form", "P-014.recog", "lex.03421", "x.1.recog"):
        with pytest.raises(InvalidMemoryItemId):
            MemoryItemId.parse(bad)


def test_derivation_examples() -> None:
    assert derive_memory_items("error_correct", {"grammar": ("G-001",)}, "txt.00001") == (
        "G-001.form",
        "G-001.judge",
    )
    assert derive_memory_items(
        "stress_tap", {"lexis": ("lex.00002",), "phonology": ("P-018",)}, "txt.00001"
    ) == ("lex.00002.recog", "P-018.disc")
    assert derive_memory_items("read_gist_mcq", {}, "txt.00004") == ("txt.00004.comp",)


# ------------------------------------------------------------------- bundles that are refused


def _mini_bundle(tmp: Path, mutate: Any = None) -> Path:
    """A one-unit bundle made from the real unit 1, optionally broken by ``mutate``."""
    unit = json.loads((DEFAULT_CONTENT_DIR / "u001.json").read_text(encoding="utf-8"))
    index = json.loads((DEFAULT_CONTENT_DIR / "index.json").read_text(encoding="utf-8"))
    index["sections"] = [{**index["sections"][0], "units": index["sections"][0]["units"][:1]}]
    if mutate is not None:
        mutate(unit, index)
    (tmp / "u001.json").write_text(json.dumps(unit), encoding="utf-8")
    (tmp / "index.json").write_text(json.dumps(index), encoding="utf-8")
    return tmp


def _first_item(unit: dict[str, Any]) -> dict[str, Any]:
    item: dict[str, Any] = unit["nodes"][0]["tiers"]["1"][0]
    return item


def test_a_good_mini_bundle_loads(tmp_path: Path) -> None:
    catalog = load_catalog(_mini_bundle(tmp_path))
    assert catalog.totals["units"] == 1


def _set_type(u: dict[str, Any], _: dict[str, Any]) -> None:
    _first_item(u)["t"] = "hologram_quiz"


def _drop_answer(u: dict[str, Any], _: dict[str, Any]) -> None:
    del _first_item(u)["a"]


def _index_out_of_range(u: dict[str, Any], _: dict[str, Any]) -> None:
    mcq = next(
        i
        for n in u["nodes"]
        for tier in n["tiers"].values()
        for i in tier
        if i["t"] == "mcq_word_from_definition"
    )
    mcq["a"]["index"] = len(mcq["p"]["options"])


def _duplicate_item(u: dict[str, Any], _: dict[str, Any]) -> None:
    u["nodes"][0]["tiers"]["1"].append(dict(_first_item(u)))


def _seven_nodes(u: dict[str, Any], _: dict[str, Any]) -> None:
    u["nodes"].pop()


def _unlisted_unit(_: dict[str, Any], index: dict[str, Any]) -> None:
    index["sections"] = []


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (_set_type, "unknown exercise type"),
        (_drop_answer, "prompt and answer"),
        (_index_out_of_range, "outside"),
        (_duplicate_item, "duplicate item id"),
        (_seven_nodes, "exactly 8 nodes"),
        (_unlisted_unit, "does not list units"),
    ],
)
def test_malformed_content_fails_loudly(tmp_path: Path, mutate: Any, message: str) -> None:
    with pytest.raises(ContentError, match=message):
        load_catalog(_mini_bundle(tmp_path, mutate))


def test_a_missing_bundle_fails_loudly(tmp_path: Path) -> None:
    with pytest.raises(ContentError, match=r"index\.json"):
        load_catalog(tmp_path)
