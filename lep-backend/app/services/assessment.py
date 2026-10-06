"""Test-out checkpoints and placement (docs/10 §4, docs/12 §2–§3, docs/16 E14, E20).

**Test-out** — any unit may be skipped by passing its test at ≥ 85 %: free, unlimited and
prominent. The form is twelve auto-gradable items from the unit's tier 2 and 3 (a fixed form
until IRT calibration exists, docs/12 §3), chosen deterministically from the checkpoint's id.
Its answers come in through the ordinary review sync with ``session_id`` = the checkpoint id,
so they schedule memory like any answer; completing the checkpoint grades them from the stored
attempts. A pass credits tier 2 on every node not yet there (marked ``tested_out``), completes
the unit (+30 gems and its passport stamps) and awards +60 gems once per unit (docs/10 §9).

**Placement** — an adaptive search over the ten sub-levels (binary search, five items a stage,
≥ 80 % right means the level is known). It grades on the server and writes no reviews: placing
is assessing, not practising. The result is the first sub-level not yet known.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Final
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.content.catalog import CEFR_LEVELS, ITEM_BEARING_KINDS, ContentCatalog, ItemRecord
from app.domain.grading import FAMILY, InvalidSubmission, Verdict, grade
from app.ids import uuid7
from app.models.assessment import Checkpoint, Placement
from app.services.gamification import Awards, GamificationService

CHECKPOINT_SIZE: Final = 12
TEST_OUT_PASS: Final = 0.85
#: a checkpoint counts when nearly every item was answered
CHECKPOINT_COVERAGE: Final = 0.9
PLACEMENT_STAGE: Final = 5
PLACEMENT_KNOWN: Final = 0.8
AUTO_GRADED_FAMILIES: Final = frozenset({"choice", "text", "bank", "order", "pairs", "bins"})
#: placement avoids items that need audio or long reading, so it works on any device quickly
PLACEMENT_TYPES: Final = frozenset(
    {
        "mcq_word_from_definition",
        "gap_fill_bank",
        "grammaticality_judgement",
        "pragmatics_choose",
        "odd_one_out",
        "type_from_l1",
        "gap_fill_free",
        "error_correct",
        "word_bank_build",
        "sentence_reorder",
    }
)


class AssessmentError(ValueError):
    """Not possible (unknown unit, finished already, …)."""


def _rank(*key: str) -> int:
    return int.from_bytes(hashlib.sha256("\x1f".join(key).encode()).digest()[:8], "big")


def _auto_graded(item: ItemRecord) -> bool:
    return item.type_id != "write_sentence" and FAMILY.get(item.type_id) in AUTO_GRADED_FAMILIES


def checkpoint_form(catalog: ContentCatalog, unit_id: str, seed: str) -> list[str]:
    """Twelve items spread over the unit's nodes, tier 3 preferred, then tier 2."""
    unit = catalog.units.get(unit_id)
    if unit is None:
        raise AssessmentError("there is no such unit")
    pools: list[list[str]] = []
    for node_id in unit.node_ids:
        node = catalog.nodes[node_id]
        if node.kind not in ITEM_BEARING_KINDS:
            continue
        candidates = [
            i for tier in (3, 2) for i in node.tiers.get(tier, ()) if _auto_graded(catalog.items[i])
        ]
        if candidates:
            pools.append(sorted(candidates, key=lambda i: _rank(seed, i)))
    if not pools:
        raise AssessmentError("this unit has no test-out form")
    picked: list[str] = []
    # round-robin over the nodes so every part of the unit is tested
    while len(picked) < CHECKPOINT_SIZE and any(pools):
        for pool in pools:
            if pool and len(picked) < CHECKPOINT_SIZE:
                picked.append(pool.pop(0))
    return picked


def placement_stage(catalog: ContentCatalog, level: int, seed: str) -> list[str]:
    cefr = CEFR_LEVELS[level]
    units = [u for u in catalog.unit_order() if catalog.units[u].cefr == cefr]
    candidates = [
        i.id
        for i in catalog.items.values()
        if i.unit_id in units and i.tier >= 2 and i.type_id in PLACEMENT_TYPES
    ]
    return sorted(candidates, key=lambda i: _rank(seed, str(level), i))[:PLACEMENT_STAGE]


@dataclass(frozen=True, slots=True)
class CheckpointResult:
    passed: bool
    accuracy: float | None
    answered: int
    total: int
    awards: Awards


@dataclass(frozen=True, slots=True)
class PlacementStep:
    placement_id: UUID
    done: bool
    level: str | None
    item_ids: list[str]
    result_level: str | None
    result_section: str | None
    result_unit: str | None


class AssessmentService:
    def __init__(self, session: AsyncSession, catalog: ContentCatalog, clock: Clock) -> None:
        self._session = session
        self._catalog = catalog
        self._clock = clock

    # ------------------------------------------------------------------- test-out

    async def start_checkpoint(self, learner_id: UUID, unit_id: str) -> Checkpoint:
        cid = uuid7()
        form = checkpoint_form(self._catalog, unit_id, str(cid))
        row = Checkpoint(
            learner_id=learner_id,
            id=cid,
            unit_id=unit_id,
            item_ids=form,
            created_at=self._clock.now(),
        )
        self._session.add(row)
        await self._session.flush()
        return row

    async def complete_checkpoint(
        self, learner_id: UUID, checkpoint_id: UUID, gamification: GamificationService
    ) -> CheckpointResult:
        row = await self._session.get(Checkpoint, (learner_id, checkpoint_id), with_for_update=True)
        if row is None:
            raise AssessmentError("there is no such checkpoint")
        # the first answer to each item counts — first as the server received it, since device
        # timestamps are the learner's to set (a backdated retry must not replace a wrong answer)
        from app.services.certification import first_answers

        first = await first_answers(
            self._session,
            learner_id,
            checkpoint_id,
            row.item_ids,
            row.created_at,
            self._clock.now() + timedelta(minutes=1),
        )
        graded = [v for v in first.values() if v != "ungraded"]
        accuracy = sum(v == "correct" for v in graded) / len(graded) if graded else None
        enough = len(first) >= math.ceil(CHECKPOINT_COVERAGE * len(row.item_ids))
        passed = enough and accuracy is not None and accuracy >= TEST_OUT_PASS
        now = self._clock.now()
        awards = Awards()
        if row.completed_at is None:
            row.completed_at = now
            row.passed = passed
            row.accuracy = accuracy
            if passed:
                awards = await gamification.credit_test_out(learner_id, row.unit_id, now)
        return CheckpointResult(
            bool(row.passed), row.accuracy, len(first), len(row.item_ids), awards
        )

    # ------------------------------------------------------------------- placement

    async def start_placement(self, learner_id: UUID) -> PlacementStep:
        pid = uuid7()
        lo, hi = 0, len(CEFR_LEVELS) - 1
        mid = (lo + hi) // 2
        items = placement_stage(self._catalog, mid, str(pid))
        self._session.add(
            Placement(
                learner_id=learner_id,
                id=pid,
                lo=lo,
                hi=hi,
                stage_level=mid,
                stage_items=items,
                history=[],
                created_at=self._clock.now(),
            )
        )
        await self._session.flush()
        return PlacementStep(pid, False, CEFR_LEVELS[mid], items, None, None, None)

    async def answer_placement(
        self, learner_id: UUID, placement_id: UUID, answers: Mapping[str, Mapping[str, Any]]
    ) -> PlacementStep:
        row = await self._session.get(Placement, (learner_id, placement_id), with_for_update=True)
        if row is None:
            raise AssessmentError("there is no such placement")
        if row.result_level is not None or row.stage_level is None:
            return self._result(row)
        correct = 0
        for item_id in row.stage_items:
            item = self._catalog.item(item_id)
            sub = answers.get(item_id)
            if item is None or sub is None:
                continue
            try:
                result = grade(
                    item.type_id, item.prompt, item.answer, sub, self._catalog.grade_context(item)
                )
            except InvalidSubmission:
                continue
            correct += int(result.verdict is Verdict.CORRECT)
        share = correct / len(row.stage_items) if row.stage_items else 0.0
        level = row.stage_level
        row.history = [
            *row.history,
            {"level": level, "correct": correct, "of": len(row.stage_items)},
        ]
        if share >= PLACEMENT_KNOWN:
            row.lo = level + 1
        else:
            row.hi = level - 1
        if row.lo > row.hi:
            row.result_level = min(row.lo, len(CEFR_LEVELS) - 1)
            row.stage_level = None
            row.stage_items = []
            return self._result(row)
        nxt = (row.lo + row.hi) // 2
        row.stage_level = nxt
        row.stage_items = placement_stage(self._catalog, nxt, f"{placement_id}:{len(row.history)}")
        return PlacementStep(
            placement_id, False, CEFR_LEVELS[nxt], list(row.stage_items), None, None, None
        )

    def _result(self, row: Placement) -> PlacementStep:
        level = row.result_level if row.result_level is not None else 0
        cefr = CEFR_LEVELS[level]
        unit = next(u for u in self._catalog.unit_order() if self._catalog.units[u].cefr == cefr)
        return PlacementStep(
            row.id, True, None, [], cefr, self._catalog.units[unit].section_id, unit
        )


def checkpoint_items(catalog: ContentCatalog, ids: Sequence[str]) -> list[ItemRecord]:
    return [catalog.items[i] for i in ids if i in catalog.items]
