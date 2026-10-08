"""A correct submission for a real item, derived from its key — for seeding the demo learner
(``scripts/seed_demo.py``) and for tests. The grader decides what is correct; this only builds
an answer the grader accepts, the way the app's tests/support/answers.ts does.
"""

from __future__ import annotations

from typing import Any

from app.content.catalog import ItemRecord
from app.domain.grading import join_tiles, normalise_readings


def _tiles_for(bank: list[str], key: str, case_insensitive: bool) -> list[int] | None:
    target = key.lower() if case_insensitive else key
    used = [False] * len(bank)
    order: list[int] = []

    def dfs() -> bool:
        text = join_tiles([bank[i] for i in order])
        text = text.lower() if case_insensitive else text
        if text == target:
            return True
        if not target.startswith(text):
            return False
        for i in range(len(bank)):
            if used[i]:
                continue
            used[i] = True
            order.append(i)
            if dfs():
                return True
            order.pop()
            used[i] = False
        return False

    return list(order) if dfs() else None


def correct_submission(item: ItemRecord) -> dict[str, Any] | None:
    p, a, t = item.prompt, item.answer, item.type_id
    rules = frozenset(a.get("normalise") or ())
    if "index" in a:
        return {"kind": "choice", "index": a["index"]}
    if t == "gap_fill_bank":
        keys = {r for k in a["key"] for r in normalise_readings(k, rules)}
        hit = next((w for w in p["bank"] if set(normalise_readings(w, rules)) & keys), None)
        return None if hit is None else {"kind": "text", "text": hit}
    if t in ("word_bank_build", "sentence_reorder"):
        tiles = _tiles_for(list(p["bank"]), a["key"][0], "case" in rules)
        return None if tiles is None else {"kind": "tiles", "indices": tiles, "text": a["key"][0]}
    if t == "listen_order_events":
        used: set[int] = set()
        indices: list[int] = []
        for line in a["key"]:
            i = next(j for j, o in enumerate(p["options"]) if o == line and j not in used)
            used.add(i)
            indices.append(i)
        return {"kind": "order", "indices": indices}
    if t in ("tap_pairs", "memory_match", "word_race"):
        n = len(p["pairs"])
        return {
            "kind": "pairs",
            "matches": [[i, i] for i in range(n)],
            "mistakes": 0,
            "complete": True,
        }
    if t == "sort_bins":
        return {
            "kind": "bins",
            "assignment": {
                str(i): p["bins"].index(a["mapping"][w]) for i, w in enumerate(p["options"])
            },
        }
    if t in ("repeat_after", "read_aloud", "speak_prompt", "speak_roleplay", "speak_retell"):
        if a.get("key"):
            return {"kind": "speech", "modality": "typed", "text": a["key"][0]}
        return {"kind": "speech", "modality": "voice"}
    if t == "write_sentence":
        # free writing: graded by a rubric, never by key — any sentence is an answer
        return {"kind": "text", "text": (a.get("key") or ["Hello, my name is Aziz."])[0]}
    if a.get("key"):
        return {"kind": "text", "text": a["key"][0]}
    return None
