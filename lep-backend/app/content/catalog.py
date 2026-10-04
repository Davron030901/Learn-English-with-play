"""The course catalog: the packed bundle, loaded once, validated, and indexed (brief Phase 2).

Source: the packed course the app also ships (``index.json`` + ``u001.json`` … ``u168.json``,
short keys — see DECISIONS.md §4). The loader:

* **refuses** malformed content: an unknown exercise type, a missing prompt or answer, an
  answer index outside its options, a duplicate id, a unit file out of sequence. A bad bundle
  fails start-up loudly rather than serving bad data;
* **counts** the known content defects (brief §14) and logs them, so the day one is fixed
  upstream it shows in the start-up line;
* restores what the bundle drops and can be derived without inventing anything — each node's
  kind from its fixed position, each item's instruction key and memory items, and the level
  of every item from its *unit* (``item.cefr`` is never trusted, brief §14.1);
* computes the same ``content_version`` as the app's packer, so the version an answer carries
  can be checked against the content the server holds.

Responses are serialised once, lazily, and cached as bytes with a strong ETag: the content is
immutable for the life of the process.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Any, Final, TypeGuard

from app.content.memory_items import UnmappedTarget, derive_memory_items
from app.domain.grading import GradeContext

#: The 31 exercise types the build uses (docs/09 lists 71; the rest are not authored yet).
INDEX_TYPES: Final = frozenset(
    {
        "mcq_word_from_definition",
        "odd_one_out",
        "grammaticality_judgement",
        "pragmatics_choose",
        "minimal_pair_discrimination",
        "phoneme_id",
        "read_gist_mcq",
        "read_scan_detail",
        "listen_gist_mcq",
        "listen_detail_gap",
        "stress_tap",
    }
)
KEY_TYPES: Final = frozenset(
    {
        "gap_fill_bank",
        "type_from_l1",
        "dictation_word",
        "dictation_sentence",
        "spelling_bee",
        "gap_fill_free",
        "error_correct",
        "write_sentence",
        "word_bank_build",
        "sentence_reorder",
        "listen_order_events",
        "repeat_after",
        "read_aloud",
        "speak_prompt",
        "speak_roleplay",
        "speak_retell",
    }
)
MAPPING_TYPES: Final = frozenset({"tap_pairs", "memory_match", "word_race", "sort_bins"})
TYPE_IDS: Final = INDEX_TYPES | KEY_TYPES | MAPPING_TYPES

#: Free speech and free writing have many right answers; their key may be empty.
OPEN_RESPONSE_TYPES: Final = frozenset(
    {"speak_prompt", "speak_roleplay", "speak_retell", "write_sentence"}
)

#: Node kind by position in the unit — N1–N3 and N5 lessons, N4 story, N6 speak, N7 immersion,
#: N8 review — verified on all 168 units (frontend DECISIONS F12).
NODE_KIND_BY_POSITION: Final[dict[int, str]] = {
    1: "lesson",
    2: "lesson",
    3: "lesson",
    4: "story",
    5: "lesson",
    6: "speak",
    7: "immersion",
    8: "review",
}
ITEM_BEARING_KINDS: Final = frozenset({"lesson", "story", "speak"})

CEFR_LEVELS: Final = ("A1.1", "A1.2", "A2.1", "A2.2", "B1.1", "B1.2", "B2.1", "B2.2", "C1", "C2")

_UNIT_FILE = re.compile(r"u(\d{3})\.json")
_UNIT_ID = re.compile(r"S(\d{2})U(\d{2})")
_NODE_ID = re.compile(r"S\d{2}U\d{2}N([1-8])")
_ITEM_ID = re.compile(r"item\.\d{7}")
_MAX_REPORTED_PROBLEMS = 25


class ContentError(RuntimeError):
    """The bundle is malformed; the service must not start on it."""


def instruction_key_for(type_id: str) -> str:
    """The build's instruction key: ``instr.<type>``, with its two shortened exceptions."""
    if type_id == "mcq_word_from_definition":
        return "instr.mcq_word"
    if type_id == "minimal_pair_discrimination":
        return "instr.minimal_pair"
    return f"instr.{type_id}"


def section_id_of(unit_id: str) -> str:
    return unit_id[:3]


def level_band(cefr: str) -> str:
    """``B1.2`` → ``B1``."""
    return cefr[:2]


# ------------------------------------------------------------------- records


@dataclass(frozen=True, slots=True)
class ItemRecord:
    id: str
    type_id: str
    unit_id: str
    node_id: str
    tier: int
    cefr: str
    instruction_key: str
    targets: Mapping[str, tuple[str, ...]]
    memory_items: tuple[str, ...]
    prompt: Mapping[str, Any]
    answer: Mapping[str, Any]
    feedback: Mapping[str, Any]
    constraints: Mapping[str, Any]
    say: str | None

    def as_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type_id": self.type_id,
            "unit_id": self.unit_id,
            "node_id": self.node_id,
            "tier": self.tier,
            "instruction_key": self.instruction_key,
            "targets": {k: list(v) for k, v in self.targets.items()},
            "memory_items": list(self.memory_items),
            "prompt": self.prompt,
            "answer": self.answer,
            "feedback": self.feedback,
            "constraints": self.constraints,
            "say": self.say,
        }


@dataclass(frozen=True, slots=True)
class NodeRecord:
    id: str
    unit_id: str
    position: int
    kind: str
    focus: str | None
    title: str
    #: tier → item ids, only for populated tiers
    tiers: Mapping[int, tuple[str, ...]]


@dataclass(frozen=True, slots=True)
class LexemeRecord:
    id: str
    lemma: str
    pos: str
    ipa: str
    gloss: Mapping[str, str]
    examples: tuple[str, ...]
    unit_id: str
    cefr: str

    def as_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "lemma": self.lemma,
            "pos": self.pos,
            "ipa": self.ipa,
            "gloss": dict(self.gloss),
            "examples": list(self.examples),
            "unit_id": self.unit_id,
            # docs/00 §4.1 rule 7 asks for one; the bundle carries none (brief §14.4)
            "definition_en": None,
        }


@dataclass(frozen=True, slots=True)
class UnitRecord:
    id: str
    section_id: str
    n: int
    cefr: str
    title: Mapping[str, str]
    can_do: tuple[str, ...]
    minutes: Mapping[str, float]
    node_ids: tuple[str, ...]
    lexeme_ids: tuple[str, ...]
    grammar: tuple[Mapping[str, Any], ...]
    phonology: tuple[Mapping[str, Any], ...]
    functions: tuple[Mapping[str, Any], ...]
    story: Mapping[str, Any]

    @property
    def story_id(self) -> str:
        return str(self.story["id"])


@dataclass(frozen=True, slots=True)
class SectionRecord:
    id: str
    cefr: str
    unit_ids: tuple[str, ...]


@dataclass(slots=True)
class ContentCatalog:
    version: str
    sections: tuple[SectionRecord, ...]
    units: Mapping[str, UnitRecord]
    nodes: Mapping[str, NodeRecord]
    items: Mapping[str, ItemRecord]
    lexemes: Mapping[str, LexemeRecord]
    instructions: Mapping[str, Mapping[str, str]]
    defects: Mapping[str, int]
    memory_item_refs: int
    memory_item_count: int
    #: The course's own English words (keys, accepted answers, lexemes and their examples,
    #: story lines, function exponents, grammar examples, can-do statements) — built exactly
    #: as the app's packer builds words.lep, because typo rule 7 depends on it.
    words: frozenset[str] = frozenset()
    _cache: dict[str, bytes] = field(default_factory=dict, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    # --------------------------------------------------------------- lookups

    def unit(self, unit_id: str) -> UnitRecord | None:
        return self.units.get(unit_id)

    def item(self, item_id: str) -> ItemRecord | None:
        return self.items.get(item_id)

    def grade_context(self, item: ItemRecord) -> GradeContext:
        """What grading this item needs beyond the item itself — the same context the app
        builds (``gradeContextFor``): lemmas and exponents come from the item's *own unit*."""
        unit = self.units[item.unit_id]
        own = set(unit.lexeme_ids)
        lemmas = tuple(
            self.lexemes[i].lemma
            for i in item.targets.get("lexis", ())
            if i in own and i in self.lexemes
        )
        by_id = {str(f.get("id")): f for f in unit.functions}
        exponents = tuple(
            str(e.get("text", ""))
            for fid in item.targets.get("functions", ())
            for e in (by_id.get(fid) or {}).get("exponents", [])
        )
        return GradeContext(words=self.words, target_lemmas=lemmas, function_exponents=exponents)

    def unit_order(self) -> tuple[str, ...]:
        return tuple(u for s in self.sections for u in s.unit_ids)

    def items_in(self, node_id: str, tier: int) -> tuple[ItemRecord, ...]:
        node = self.nodes.get(node_id)
        if node is None:
            return ()
        return tuple(self.items[i] for i in node.tiers.get(tier, ()))

    @property
    def totals(self) -> dict[str, int]:
        return {
            "sections": len(self.sections),
            "units": len(self.units),
            "nodes": len(self.nodes),
            "node_tiers": sum(len(n.tiers) for n in self.nodes.values()),
            "items": len(self.items),
            "lexemes": len(self.lexemes),
            "stories": len(self.units),
            "memory_items": self.memory_item_count,
        }

    # --------------------------------------------------------------- serialised responses

    def etag(self, scope: str) -> str:
        return f'"{self.version}:{scope}"'

    def _cached(self, key: str, build: Any) -> bytes:
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        with self._lock:
            hit = self._cache.get(key)
            if hit is None:
                hit = _dumps(build())
                self._cache[key] = hit
        return hit

    def course_json(self) -> bytes:
        return self._cached("course", self._course)

    def unit_json(self, unit_id: str) -> bytes | None:
        if unit_id not in self.units:
            return None
        return self._cached(f"unit:{unit_id}", lambda: self._unit(unit_id))

    def _course(self) -> dict[str, Any]:
        return {
            "content_version": self.version,
            "totals": self.totals,
            "instructions": {k: dict(v) for k, v in self.instructions.items()},
            "sections": [
                {
                    "id": s.id,
                    "cefr": s.cefr,
                    "units": [self._unit_outline(self.units[u]) for u in s.unit_ids],
                }
                for s in self.sections
            ],
        }

    def _unit_outline(self, unit: UnitRecord) -> dict[str, Any]:
        nodes = [self.nodes[n] for n in unit.node_ids]
        return {
            "id": unit.id,
            "section_id": unit.section_id,
            "n": unit.n,
            "cefr": unit.cefr,
            "title": dict(unit.title),
            "can_do": list(unit.can_do),
            "minutes": dict(unit.minutes),
            "lexeme_count": len(unit.lexeme_ids),
            "grammar_count": len(unit.grammar),
            "item_count": sum(len(ids) for n in nodes for ids in n.tiers.values()),
            "story": {"id": unit.story_id, "title": unit.story.get("title", "")},
            "nodes": [
                {
                    "id": n.id,
                    "position": n.position,
                    "kind": n.kind,
                    "focus": n.focus,
                    "title": n.title,
                    "tier_counts": {str(t): len(ids) for t, ids in sorted(n.tiers.items())},
                }
                for n in nodes
            ],
        }

    def _unit(self, unit_id: str) -> dict[str, Any]:
        unit = self.units[unit_id]
        return {
            "content_version": self.version,
            "id": unit.id,
            "section_id": unit.section_id,
            "n": unit.n,
            "cefr": unit.cefr,
            "title": dict(unit.title),
            "can_do": list(unit.can_do),
            "minutes": dict(unit.minutes),
            "nodes": [
                {
                    "id": node.id,
                    "position": node.position,
                    "kind": node.kind,
                    "focus": node.focus,
                    "title": node.title,
                    "tiers": {
                        str(t): [self.items[i].as_json() for i in ids]
                        for t, ids in sorted(node.tiers.items())
                    },
                }
                for node in (self.nodes[n] for n in unit.node_ids)
            ],
            "lexemes": [self.lexemes[lx].as_json() for lx in unit.lexeme_ids],
            "grammar": list(unit.grammar),
            "phonology": list(unit.phonology),
            "functions": list(unit.functions),
            "story": unit.story,
        }


def _dumps(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


# ------------------------------------------------------------------- loading


class _Problems:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.defects: Counter[str] = Counter()

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def raise_if_any(self, directory: Path) -> None:
        if not self.errors:
            return
        shown = "; ".join(self.errors[:_MAX_REPORTED_PROBLEMS])
        more = len(self.errors) - _MAX_REPORTED_PROBLEMS
        suffix = f" (and {more} more)" if more > 0 else ""
        raise ContentError(f"malformed course content in {directory}: {shown}{suffix}")


def _str_list(value: Any) -> TypeGuard[list[str]]:
    return isinstance(value, list) and all(isinstance(x, str) for x in value)


def _check_item(raw: Mapping[str, Any], where: str, problems: _Problems) -> bool:
    """Structural checks that make an item unusable; returns False when it must be refused."""
    type_id = raw.get("t")
    prompt = raw.get("p")
    answer = raw.get("a")
    if type_id not in TYPE_IDS:
        problems.error(f"{where}: unknown exercise type {type_id!r}")
        return False
    if not isinstance(prompt, dict) or not isinstance(answer, dict):
        problems.error(f"{where}: prompt and answer must be objects")
        return False
    if raw.get("tier") not in (1, 2, 3):
        problems.error(f"{where}: tier must be 1, 2 or 3")
        return False
    if type_id in INDEX_TYPES:
        choices = prompt.get("syllables" if type_id == "stress_tap" else "options")
        index = answer.get("index")
        if not _str_list(choices) or not isinstance(index, int) or isinstance(index, bool):
            problems.error(f"{where}: {type_id} needs a list of choices and an integer index")
            return False
        if not 0 <= index < len(choices):
            problems.error(f"{where}: answer index {index} outside {len(choices)} choices")
            return False
        if len(choices) < 2:
            problems.defects["single_option"] += 1
    elif type_id in KEY_TYPES:
        key = answer.get("key")
        if not _str_list(key):
            problems.error(f"{where}: {type_id} needs answer.key as a list of strings")
            return False
        if not key and type_id not in OPEN_RESPONSE_TYPES:
            problems.error(f"{where}: {type_id} has an empty answer key")
            return False
        if "accepted" in answer and not _str_list(answer["accepted"]):
            problems.error(f"{where}: answer.accepted must be a list of strings")
            return False
        if type_id == "listen_order_events" and sorted(key) != sorted(prompt.get("options", [])):
            problems.error(f"{where}: listen_order_events key is not an order of its options")
            return False
    else:
        mapping = answer.get("mapping")
        if not isinstance(mapping, dict) or not mapping:
            problems.error(f"{where}: {type_id} needs a non-empty answer.mapping")
            return False
    if type_id == "stress_tap":
        squash = re.sub(r"[^a-z]", "", "".join(prompt.get("syllables", [])).lower())
        if squash != re.sub(r"[^a-z]", "", str(prompt.get("text", "")).lower()):
            problems.defects["stress_syllables_do_not_spell_the_word"] += 1
    if not raw.get("fb"):
        problems.defects["no_feedback"] += 1
    return True


_WORD = re.compile(r"[a-z]+(?:['\u2019][a-z]+)?")


def _add_words(words: set[str], text: Any) -> None:
    if not isinstance(text, str):
        return
    for m in _WORD.finditer(text.lower()):
        words.add(m.group(0).replace("\u2019", "'"))


def _read_json(path: Path) -> tuple[bytes, Any]:
    data = path.read_bytes()
    return data, json.loads(data.decode("utf-8"))


def load_catalog(directory: Path) -> ContentCatalog:
    """Load and validate the packed course. Raises ContentError on any structural problem."""
    directory = directory.resolve()
    index_path = directory / "index.json"
    if not index_path.is_file():
        raise ContentError(f"no index.json in {directory} (set LEP_CONTENT_DIR)")
    unit_files = sorted(p for p in directory.iterdir() if _UNIT_FILE.fullmatch(p.name))
    if not unit_files:
        raise ContentError(f"no unit files (u001.json …) in {directory}")

    problems = _Problems()
    digest = hashlib.sha256()  # the app's packer hashes the same bytes in the same order
    index_bytes, index = _read_json(index_path)

    units: dict[str, UnitRecord] = {}
    nodes: dict[str, NodeRecord] = {}
    items: dict[str, ItemRecord] = {}
    lexemes: dict[str, LexemeRecord] = {}
    memory_items: set[str] = set()
    memory_refs = 0
    words: set[str] = set()

    for expected_n, path in enumerate(unit_files, start=1):
        data, raw = _read_json(path)
        digest.update(path.name.encode("utf-8"))
        digest.update(data)
        unit_id = raw.get("id", "")
        where_u = f"{path.name}"
        if raw.get("n") != expected_n or int(path.name[1:4]) != expected_n:
            problems.error(
                f"{where_u}: unit files must run u001…u{len(unit_files):03d} without gaps"
            )
            continue
        if not _UNIT_ID.fullmatch(unit_id) or unit_id in units:
            problems.error(f"{where_u}: bad or duplicate unit id {unit_id!r}")
            continue
        cefr = raw.get("cefr")
        if cefr not in CEFR_LEVELS:
            problems.error(f"{where_u}: unknown level {cefr!r}")
            continue
        story = raw.get("story")
        if not isinstance(story, dict) or not re.fullmatch(r"txt\.\d{5}", str(story.get("id"))):
            problems.error(f"{where_u}: missing story")
            continue
        raw_nodes = raw.get("nodes")
        if not isinstance(raw_nodes, list) or len(raw_nodes) != 8:
            problems.error(f"{where_u}: a unit has exactly 8 nodes")
            continue

        node_ids: list[str] = []
        for position, rn in enumerate(raw_nodes, start=1):
            node_id = rn.get("id", "")
            m = _NODE_ID.fullmatch(node_id)
            if not m or not node_id.startswith(unit_id) or int(m.group(1)) != position:
                problems.error(f"{where_u}: node {position} has id {node_id!r}")
                continue
            kind = NODE_KIND_BY_POSITION[position]
            tiers: dict[int, tuple[str, ...]] = {}
            for tier_key, tier_items in sorted((rn.get("tiers") or {}).items()):
                ids: list[str] = []
                for ri in tier_items or []:
                    for text in [
                        *(ri.get("a") or {}).get("key", []),
                        *(ri.get("a") or {}).get("accepted", []),
                    ]:
                        _add_words(words, text)
                    item_id = ri.get("id", "")
                    where = f"{node_id}/{item_id or '?'}"
                    if not _ITEM_ID.fullmatch(item_id) or item_id in items:
                        problems.error(f"{where}: bad or duplicate item id")
                        continue
                    if str(ri.get("tier")) != str(tier_key):
                        problems.error(
                            f"{where}: filed under tier {tier_key} but says {ri.get('tier')}"
                        )
                        continue
                    if not _check_item(ri, where, problems):
                        continue
                    targets = {
                        fam: tuple(ids_)
                        for fam, ids_ in (ri.get("tg") or {}).items()
                        if isinstance(ids_, list) and ids_
                    }
                    try:
                        mem = derive_memory_items(ri["t"], targets, str(story["id"]))
                    except UnmappedTarget as exc:
                        problems.error(f"{where}: {exc}")
                        continue
                    memory_refs += len(mem)
                    memory_items.update(mem)
                    say = ri.get("say")
                    items[item_id] = ItemRecord(
                        id=item_id,
                        type_id=ri["t"],
                        unit_id=unit_id,
                        node_id=node_id,
                        tier=int(ri["tier"]),
                        cefr=cefr,  # from the unit, never from the item (brief §14.1)
                        instruction_key=instruction_key_for(ri["t"]),
                        targets=targets,
                        memory_items=mem,
                        prompt=ri["p"],
                        answer=ri["a"],
                        feedback=ri.get("fb") or {},
                        constraints=ri.get("c") or {},
                        say=say if isinstance(say, str) else None,
                    )
                    ids.append(item_id)
                if ids:
                    tiers[int(tier_key)] = tuple(ids)
            if kind in ITEM_BEARING_KINDS and 0 < len(tiers) < 3:
                problems.defects["node_with_missing_tiers"] += 1
            nodes[node_id] = NodeRecord(
                id=node_id,
                unit_id=unit_id,
                position=position,
                kind=kind,
                focus=rn.get("focus") or None,
                title=str(rn.get("title", "")),
                tiers=tiers,
            )
            node_ids.append(node_id)

        for rl in raw.get("lex") or []:
            _add_words(words, rl.get("w"))
            for ex in rl.get("ex") or []:
                _add_words(words, ex)
        for line in story.get("body") or []:
            _add_words(words, line.get("text"))
        for f in raw.get("functions") or []:
            for e in f.get("exponents") or []:
                _add_words(words, e.get("text"))
        for g in raw.get("grammar") or []:
            _add_words(words, g.get("positive_example"))
        for c in raw.get("can_do") or []:
            _add_words(words, c)

        lexeme_ids: list[str] = []
        for rl in raw.get("lex") or []:
            lid = rl.get("id", "")
            if not re.fullmatch(r"lex\.\d{5}", lid):
                problems.error(f"{where_u}: bad lexeme id {lid!r}")
                continue
            lexeme_ids.append(lid)
            if lid in lexemes:
                continue
            lexemes[lid] = LexemeRecord(
                id=lid,
                lemma=str(rl.get("w", "")),
                pos=str(rl.get("pos", "")),
                ipa=str(rl.get("ipa", "")),
                gloss={k: str(rl[k]) for k in ("uz", "ru") if k in rl},
                examples=tuple(rl.get("ex") or ()),
                unit_id=unit_id,
                cefr=cefr,
            )

        units[unit_id] = UnitRecord(
            id=unit_id,
            section_id=section_id_of(unit_id),
            n=expected_n,
            cefr=cefr,
            title=dict(raw.get("title") or {}),
            can_do=tuple(raw.get("can_do") or ()),
            minutes=dict(raw.get("minutes") or {}),
            node_ids=tuple(node_ids),
            lexeme_ids=tuple(lexeme_ids),
            grammar=tuple(raw.get("grammar") or ()),
            phonology=tuple(raw.get("phonology") or ()),
            functions=tuple(raw.get("functions") or ()),
            story=story,
        )

    digest.update(b"index.json")
    digest.update(index_bytes)

    sections: list[SectionRecord] = []
    listed: set[str] = set()
    for rs in index.get("sections") or []:
        unit_ids = tuple(u.get("id", "") for u in rs.get("units") or [])
        missing = [u for u in unit_ids if u not in units]
        if missing:
            problems.error(f"index.json: section {rs.get('id')} lists unknown units {missing[:3]}")
        listed.update(unit_ids)
        sections.append(
            SectionRecord(id=str(rs.get("id")), cefr=str(rs.get("cefr")), unit_ids=unit_ids)
        )
    unlisted = sorted(set(units) - listed)
    if unlisted:
        problems.error(f"index.json does not list units {unlisted[:3]}")

    instructions: dict[str, dict[str, str]] = {}
    for key, value in (index.get("instr") or {}).items():
        if isinstance(value, list) and value:
            instructions[key] = {
                "en": str(value[0]),
                **({"uz": str(value[1])} if len(value) > 1 else {}),
            }
    for it in items.values():
        if it.instruction_key not in instructions:
            problems.error(f"{it.id}: no instruction string for {it.instruction_key}")
            break

    problems.raise_if_any(directory)
    return ContentCatalog(
        version=f"sha256:{digest.hexdigest()[:16]}",
        sections=tuple(sections),
        units=units,
        nodes=nodes,
        items=items,
        lexemes=lexemes,
        instructions=instructions,
        defects=dict(problems.defects),
        memory_item_refs=memory_refs,
        memory_item_count=len(memory_items),
        words=frozenset(w for w in words if len(w) > 1 or w in ("a", "i")),
    )


@cache
def load_catalog_cached(directory: Path) -> ContentCatalog:
    """One catalog per directory per process: the content is immutable while the process runs
    (the API's start-up, every test app and the replay command share it)."""
    return load_catalog(directory)


def units_in_order(catalog: ContentCatalog) -> Sequence[UnitRecord]:
    return [catalog.units[u] for u in catalog.unit_order()]
