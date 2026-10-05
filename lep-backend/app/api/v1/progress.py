"""Progress (coverage first), the Word Garden, the due queue and session summaries."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.content.catalog import ContentCatalog
from app.deps import ContainerDep, CurrentPrincipal, DbSession
from app.errors import InvalidToken
from app.models.gamification import NodeProgress, XpEvent
from app.models.review import ReviewAttempt
from app.repositories.learners import LearnerRepository
from app.schemas.gamification import (
    BadgeOut,
    CoverageOut,
    DueItem,
    DueQueue,
    GardenBed,
    GardenBeds,
    GardenSummary,
    LevelOut,
    NodeTier,
    Plant,
    ProgressOut,
    SessionSummary,
    UnitStatus,
)
from app.schemas.problem import problem_responses
from app.services.progress import (
    COVERAGE_METHOD,
    STAGE,
    ProgressService,
    est_minutes,
    required_nodes,
)

router = APIRouter(tags=["progress"])


@router.get(
    "/progress",
    summary="Coverage first, then the level, the path and the passport (docs/10 §4.1)",
    responses=problem_responses(401, 429, 503),
)
async def get_progress(
    principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> ProgressOut:
    catalog = container.content
    async with session.begin():
        service = ProgressService(session, catalog)
        lexemes = await service.lexemes(principal.learner_id, container.clock.now())
        known, learning, percent = service.coverage(lexemes)
        tiers, done = await service.path(principal.learner_id)
        current = service.current_unit(tiers, done)
        cefr, units_done, units_total = service.level(current, done)
        badges = await service.badges(principal.learner_id)
    units = [
        UnitStatus(
            unit_id=u,
            tiers=tiers.get(u, {}),
            completed=u in done
            or (
                bool(required_nodes(catalog, u))
                and all(tiers.get(u, {}).get(n, 0) >= 2 for n in required_nodes(catalog, u))
            ),
        )
        for u in catalog.unit_order()
        if u in tiers or u in done
    ]
    return ProgressOut(
        coverage=CoverageOut(
            known_lexemes=known,
            learning_lexemes=learning,
            total_lexemes=len(catalog.lexemes),
            estimate_percent=percent,
            method=COVERAGE_METHOD,
            audited=False,
        ),
        level=LevelOut(
            cefr=cefr,
            units_done=units_done,
            units_total=units_total,
            percent=round(100 * units_done / units_total, 1) if units_total else 0.0,
        ),
        units=units,
        current_unit=current,
        badges=[
            BadgeOut(id=b, unit_id=u, text=_badge_text(catalog, b), awarded_at=at)
            for b, u, at in badges
        ],
    )


def _badge_text(catalog: ContentCatalog, badge_id: str) -> str:
    unit_id, _, n = badge_id.partition(":")
    unit = catalog.units.get(unit_id)
    if unit is None or not n.isdigit() or not 0 < int(n) <= len(unit.can_do):
        return ""
    return unit.can_do[int(n) - 1]


# ------------------------------------------------------------------- the Word Garden


@router.get(
    "/garden/summary",
    summary="The Word Garden at a glance: what is thirsty and how the plants are growing",
    responses=problem_responses(401, 429, 503),
)
async def garden_summary(
    principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> GardenSummary:
    now = container.clock.now()
    async with session.begin():
        service = ProgressService(session, container.content)
        lexemes = await service.lexemes(principal.learner_id, now)
        total_due, _ = await service.due(principal.learner_id, now, limit=0)
    return GardenSummary(
        as_of=now,
        due_count=sum(1 for v in lexemes.values() if v.thirsty),
        est_minutes=est_minutes(total_due),
        stages=service.stages(lexemes),
        audited=False,
    )


@router.get(
    "/garden/beds",
    summary="The garden's beds, one per unit, ten per page",
    responses=problem_responses(401, 422, 429, 503),
)
async def garden_beds(
    principal: CurrentPrincipal,
    session: DbSession,
    container: ContainerDep,
    cursor: Annotated[int, Query(ge=0, le=10_000)] = 0,
    unit_id: Annotated[str | None, Query(pattern=r"^S\d{2}U\d{2}$")] = None,
) -> GardenBeds:
    catalog = container.content
    async with session.begin():
        service = ProgressService(session, catalog)
        lexemes = await service.lexemes(principal.learner_id, container.clock.now())
    page, nxt = service.beds(lexemes, cursor, unit_id)
    return GardenBeds(
        beds=[
            GardenBed(
                unit_id=u,
                title=dict(catalog.units[u].title),
                plants=[
                    Plant(
                        lexeme_id=p.lexeme_id,
                        lemma=catalog.lexemes[p.lexeme_id].lemma,
                        stage=STAGE[p.weakest],  # type: ignore[arg-type]
                        health=p.health,
                        due_at=p.due_at,
                        thirsty=p.thirsty,
                        aspects=p.aspects,
                    )
                    for p in plants
                ],
            )
            for u, plants in page
        ],
        next_cursor=str(nxt) if nxt is not None else None,
    )


# ------------------------------------------------------------------- the due queue


@router.get(
    "/reviews/due",
    summary="What the scheduler wants reviewed now, each with an exercise to review it",
    responses=problem_responses(401, 422, 429, 503),
)
async def due_reviews(
    principal: CurrentPrincipal,
    session: DbSession,
    container: ContainerDep,
    limit: Annotated[int, Query(ge=1, le=60)] = 20,
) -> DueQueue:
    now = container.clock.now()
    async with session.begin():
        total, picked = await ProgressService(session, container.content).due(
            principal.learner_id, now, limit
        )
    return DueQueue(
        as_of=now,
        total_due=total,
        items=[
            DueItem(
                memory_item_id=m.memory_item_id, item_id=item_id, due_at=m.due, retrievability=r
            )
            for m, item_id, r in picked
        ],
    )


# ------------------------------------------------------------------- one session


@router.get(
    "/sessions/{session_id}/summary",
    summary="What one lesson session earned: answers, XP and the node-tiers it completed",
    responses=problem_responses(401, 429, 503),
)
async def session_summary(
    session_id: UUID, principal: CurrentPrincipal, session: DbSession
) -> SessionSummary:
    async with session.begin():
        if await LearnerRepository(session).profile(principal.learner_id) is None:
            raise InvalidToken("This account no longer exists.")
        answers = (
            await session.execute(
                select(
                    func.count(),
                    func.count().filter(ReviewAttempt.verdict == "correct"),
                    func.count().filter(ReviewAttempt.verdict != "ungraded"),
                ).where(
                    ReviewAttempt.learner_id == principal.learner_id,
                    ReviewAttempt.session_id == session_id,
                )
            )
        ).one()
        xp = (
            await session.execute(
                select(func.coalesce(func.sum(XpEvent.xp_centi), 0)).where(
                    XpEvent.learner_id == principal.learner_id, XpEvent.session_id == session_id
                )
            )
        ).scalar_one()
        nodes = await session.execute(
            select(NodeProgress.node_id, NodeProgress.tier).where(
                NodeProgress.learner_id == principal.learner_id,
                NodeProgress.session_id == session_id,
            )
        )
    return SessionSummary(
        session_id=str(session_id),
        answers=int(answers[0]),
        correct=int(answers[1]),
        graded=int(answers[2]),
        xp=(int(xp) + 50) // 100,
        nodes_completed=[NodeTier(node_id=n.node_id, tier=n.tier) for n in nodes],
    )
