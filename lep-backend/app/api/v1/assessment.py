"""Test-out checkpoints, placement and the cosmetic shop (docs/10 §4, §9; docs/16 E14, E17, E20)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.api.v1.gamification import awards_out
from app.content.catalog import ContentCatalog
from app.deps import ContainerDep, CurrentPrincipal, DbSession
from app.domain import shop
from app.errors import Conflict, InvalidToken, NotFound
from app.ids import uuid7
from app.models.gamification import Cosmetic, GemLedger
from app.repositories.learners import LearnerRepository
from app.repositories.reviews import ReviewRepository
from app.schemas.assessment import (
    CheckpointOut,
    CheckpointRequest,
    CheckpointResultOut,
    PlacementAnswers,
    PlacementOut,
    ShopAction,
    ShopItemOut,
    ShopOut,
)
from app.schemas.problem import problem_responses
from app.services.assessment import TEST_OUT_PASS, AssessmentError, AssessmentService, PlacementStep
from app.services.gamification import GamificationService

router = APIRouter(tags=["assessment"])


class ShopRefused(Conflict):
    type = "shop_refused"
    title = "Not possible in the shop"


async def _require_learner(principal: CurrentPrincipal, session: DbSession) -> None:
    if await LearnerRepository(session).profile(principal.learner_id) is None:
        raise InvalidToken("This account no longer exists.")


# ------------------------------------------------------------------- test-out


@router.post(
    "/assessment/checkpoints",
    status_code=201,
    summary="Start a unit test-out: twelve items, 85 % passes, free and unlimited",
    responses=problem_responses(401, 404, 422, 429, 503),
)
async def start_checkpoint(
    body: CheckpointRequest,
    principal: CurrentPrincipal,
    session: DbSession,
    container: ContainerDep,
) -> CheckpointOut:
    async with session.begin():
        await _require_learner(principal, session)
        try:
            row = await AssessmentService(
                session, container.content, container.clock
            ).start_checkpoint(principal.learner_id, body.unit_id)
        except AssessmentError as exc:
            raise NotFound(str(exc)) from None
    return CheckpointOut(
        checkpoint_id=row.id,
        unit_id=row.unit_id,
        item_ids=list(row.item_ids),
        pass_percent=round(TEST_OUT_PASS * 100),
    )


@router.post(
    "/assessment/checkpoints/{checkpoint_id}/complete",
    summary="Grade a test-out from its synced answers; a pass completes the unit",
    responses=problem_responses(401, 404, 429, 503),
)
async def complete_checkpoint(
    checkpoint_id: UUID, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> CheckpointResultOut:
    async with session.begin():
        await _require_learner(principal, session)
        # the same per-learner lock as review ingest: credits and gems never interleave
        await ReviewRepository(session).lock_learner(principal.learner_id)
        service = AssessmentService(session, container.content, container.clock)
        try:
            result = await service.complete_checkpoint(
                principal.learner_id,
                checkpoint_id,
                GamificationService(session, container.content, container.clock),
            )
        except AssessmentError as exc:
            raise NotFound(str(exc)) from None
    return CheckpointResultOut(
        passed=result.passed,
        accuracy=result.accuracy,
        answered=result.answered,
        total=result.total,
        awards=awards_out(result.awards),
    )


# ------------------------------------------------------------------- placement


def _placement_out(step: PlacementStep, catalog: ContentCatalog) -> PlacementOut:
    return PlacementOut(
        placement_id=step.placement_id,
        done=step.done,
        level=step.level,
        item_ids=step.item_ids,
        unit_ids=sorted({catalog.items[i].unit_id for i in step.item_ids if i in catalog.items}),
        result_level=step.result_level,
        result_section=step.result_section,
        result_unit=step.result_unit,
    )


@router.post(
    "/assessment/placement",
    status_code=201,
    summary="Start 'Find your level': an adaptive search, five items a stage",
    responses=problem_responses(401, 429, 503),
)
async def start_placement(
    principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> PlacementOut:
    async with session.begin():
        await _require_learner(principal, session)
        step = await AssessmentService(session, container.content, container.clock).start_placement(
            principal.learner_id
        )
    return _placement_out(step, container.content)


@router.post(
    "/assessment/placement/{placement_id}/answers",
    summary="Answer a placement stage; returns the next stage or the result",
    responses=problem_responses(401, 404, 422, 429, 503),
)
async def answer_placement(
    placement_id: UUID,
    body: PlacementAnswers,
    principal: CurrentPrincipal,
    session: DbSession,
    container: ContainerDep,
) -> PlacementOut:
    async with session.begin():
        await _require_learner(principal, session)
        try:
            step = await AssessmentService(
                session, container.content, container.clock
            ).answer_placement(principal.learner_id, placement_id, body.answers)
        except AssessmentError as exc:
            raise NotFound(str(exc)) from None
    return _placement_out(step, container.content)


# ------------------------------------------------------------------- the cosmetic shop


async def _shop(principal: CurrentPrincipal, session: DbSession) -> ShopOut:
    balance = (
        await session.execute(
            select(func.coalesce(func.sum(GemLedger.amount), 0)).where(
                GemLedger.learner_id == principal.learner_id
            )
        )
    ).scalar_one()
    owned = {
        r.item_id: r.equipped
        for r in await session.execute(
            select(Cosmetic.item_id, Cosmetic.equipped).where(
                Cosmetic.learner_id == principal.learner_id
            )
        )
    }
    return ShopOut(
        gems=int(balance),
        items=[
            ShopItemOut(
                id=i.id,
                kind=i.kind,  # type: ignore[arg-type]
                price=i.price,
                name=i.name,
                owned=i.id in owned,
                equipped=owned.get(i.id, False),
            )
            for i in shop.CATALOGUE
        ],
        note="Gems buy looks only — never lessons, hints, streak freezes or tests.",
    )


@router.get(
    "/shop", summary="Cosmetics for gems you earned", responses=problem_responses(401, 429, 503)
)
async def get_shop(principal: CurrentPrincipal, session: DbSession) -> ShopOut:
    async with session.begin():
        await _require_learner(principal, session)
        return await _shop(principal, session)


@router.post(
    "/shop/purchase",
    summary="Buy a cosmetic with earned gems",
    responses=problem_responses(401, 409, 422, 429, 503),
)
async def purchase(
    body: ShopAction, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> ShopOut:
    async with session.begin():
        await _require_learner(principal, session)
        # serialised with ingest and other purchases, so a balance is never spent twice
        await ReviewRepository(session).lock_learner(principal.learner_id)
        current = await _shop(principal, session)
        try:
            item = shop.check_purchase(
                body.item_id, current.gems, frozenset(i.id for i in current.items if i.owned)
            )
        except shop.ShopError as exc:
            raise ShopRefused(str(exc)) from None
        now = container.clock.now()
        await session.execute(
            insert(GemLedger).values(
                learner_id=principal.learner_id,
                id=uuid7(),
                ts=now,
                amount=-item.price,
                reason="purchase",
                ref=item.id,
            )
        )
        await session.execute(
            insert(Cosmetic)
            .values(
                learner_id=principal.learner_id, item_id=item.id, acquired_at=now, equipped=False
            )
            .on_conflict_do_nothing()
        )
        return await _shop(principal, session)


@router.post(
    "/shop/equip",
    summary="Wear or use a cosmetic you own (one per slot)",
    responses=problem_responses(401, 409, 422, 429, 503),
)
async def equip(body: ShopAction, principal: CurrentPrincipal, session: DbSession) -> ShopOut:
    async with session.begin():
        await _require_learner(principal, session)
        item = shop.BY_ID.get(body.item_id)
        mine = {
            c.item_id: c
            for (c,) in await session.execute(
                select(Cosmetic)
                .where(Cosmetic.learner_id == principal.learner_id)
                .with_for_update()
            )
        }
        if item is None or item.id not in mine:
            raise ShopRefused("you do not own this")
        for item_id, row in mine.items():
            other = shop.BY_ID.get(item_id)
            if other is not None and other.slot == item.slot:
                row.equipped = item_id == item.id
        await session.flush()
        return await _shop(principal, session)
