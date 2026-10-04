"""Client and server grade alike (backend brief §5.7, §7).

``tests/fixtures/grading-vectors.json.gz`` holds verdicts the app's own grader gave to real
items — right answers, wrong ones, and the near-misses normalisation exists for. It is exported
by the app's ``tests/sweep/vectors.test.ts``; regenerate it whenever either grader changes:

    cd lep-frontend
    LEP_EXPORT_VECTORS=../lep-backend/tests/fixtures/grading-vectors.json.gz \\
        npx vitest run tests/sweep/vectors.test.ts
"""

from __future__ import annotations

import gzip
import json
from collections import Counter
from pathlib import Path
from typing import Any

import pytest

from app.config import DEFAULT_CONTENT_DIR
from app.content.catalog import ContentCatalog, load_catalog_cached
from app.domain.grading import (
    GradeContext,
    Verdict,
    apply_punct,
    base_normalise,
    expand_contractions,
    grade,
    join_tiles,
    match_text,
    normalise_readings,
    within_one_edit,
)

VECTORS = Path(__file__).resolve().parents[1] / "fixtures" / "grading-vectors.json.gz"


@pytest.fixture(scope="module")
def catalog() -> ContentCatalog:
    return load_catalog_cached(DEFAULT_CONTENT_DIR)


@pytest.fixture(scope="module")
def vectors() -> list[dict[str, Any]]:
    data: list[dict[str, Any]] = json.loads(gzip.decompress(VECTORS.read_bytes()))
    return data


def test_the_server_agrees_with_the_app_on_every_vector(
    catalog: ContentCatalog, vectors: list[dict[str, Any]]
) -> None:
    disagreements: list[str] = []
    verdicts: Counter[str] = Counter()
    typos = 0
    for v in vectors:
        item = catalog.items[v["i"]]
        result = grade(item.type_id, item.prompt, item.answer, v["s"], catalog.grade_context(item))
        verdicts[result.verdict.value] += 1
        expected_typo = tuple(v["t"]) if v["t"] else None
        rejected = result.rejected[0] if result.rejected else None
        if result.verdict.value != v["v"] or result.typo != expected_typo or rejected != v["r"]:
            disagreements.append(
                f"{item.id} {item.type_id} {v['s']}: app {v['v']}/{v['t']}/{v['r']}, "
                f"server {result.verdict.value}/{result.typo}/{rejected}"
            )
        if result.typo:
            typos += 1
    assert disagreements[:15] == []
    assert len(vectors) > 30_000
    # the sample really exercises each outcome
    assert verdicts["correct"] > 10_000
    assert verdicts["incorrect"] > 10_000
    assert verdicts["ungraded"] > 100
    assert typos > 100


# ------------------------------------------------------------------- the rules, by example


def test_rule_1_folds_quotes_dashes_and_spaces() -> None:
    assert base_normalise("  It’s  “fine” — ok… ") == 'It\'s "fine" - ok...'


def test_punct_keeps_apostrophes_and_hyphens_inside_words() -> None:
    assert apply_punct("Don't stop, well-known 'friend'!") == "Don't stop well-known friend"


def test_contractions_expand_to_every_reading() -> None:
    assert expand_contractions("He's here") == ["He is here", "He has here"]
    assert expand_contractions("Aziz's book") == ["Aziz's book"]


def test_us_and_uk_spellings_are_both_accepted() -> None:
    rules = frozenset({"case", "spelling_variant"})
    assert normalise_readings("My favourite colour", rules) == normalise_readings(
        "my favorite color", rules
    )


def test_one_slip_is_forgiven_but_not_a_real_word() -> None:
    ctx = GradeContext(words=frozenset({"from", "form"}))
    rules = frozenset({"case", "typo1"})
    slip = match_text("I like apples", ["I like aplpes"], rules, ctx, allow_typo=True)
    assert slip.ok
    assert slip.typo == ("apples", "aplpes")
    assert not match_text("It is form me", ["It is from me"], rules, ctx, allow_typo=True).ok
    assert within_one_edit("teh", "the")
    assert not within_one_edit("abcd", "dcba")


def test_bank_text_is_rebuilt_from_the_tiles() -> None:
    assert join_tiles(["I", "do", "n't", "know", "."]) == "I don't know."
    result = grade(
        "sentence_reorder",
        {"bank": ["Aziz", "am", "I", "."]},
        {"key": ["I am Aziz."], "normalise": ["case", "punct"]},
        {"kind": "tiles", "indices": [2, 1, 0, 3], "text": "a forged text"},
        GradeContext(),
    )
    assert result.verdict is Verdict.CORRECT


def test_free_speech_is_never_marked_wrong() -> None:
    result = grade(
        "speak_prompt",
        {"text": "Greet someone"},
        {"key": ["Hello!"]},
        {"kind": "speech", "modality": "typed", "text": "Howdy partner"},
        GradeContext(function_exponents=("Hi!",)),
    )
    assert result.verdict is Verdict.UNGRADED
