"""Opt-in weekly leagues (docs/10 §6, docs/16 E23).

Joining and leaving are settings (``PATCH /v1/me/settings {leagues_opt_in}``); these routes
read the week's group and the results. There is no push about rank or demotion: a finished
week's result is returned here until the app has shown it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.deps import ContainerDep, CurrentPrincipal, DbSession
from app.errors import AppError, Conflict, FieldError, InvalidToken, ValidationFailed
from app.repositories.learners import LearnerRepository, Profile
from app.schemas.leagues import (
    LeagueHistoryOut,
    LeagueOut,
    LeagueResultOut,
    LeagueRow,
    LeagueStatusOut,
)
from app.schemas.problem import problem_responses
from app.services.leagues import LeagueService, Result

router = APIRouter(tags=["leagues"])


class LeaguesNotForMinors(AppError):
    """docs/10 §8.8: no leagues for a learner who might be under 18 — enforced here."""

    status = 403
    type = "leagues_not_for_minors"
    title = "Leagues are for adults only"


class DisplayNameRequired(Conflict):
    """Others in the group see a display name, so a learner joins with one (docs/16 E23)."""

    type = "display_name_required"
    title = "Choose a display name first"


def result_out(r: Result) -> LeagueResultOut:
    return LeagueResultOut(
        week_starts_at=r.week_starts_at,
        week_ends_at=r.week_ends_at,
        tier_before=r.tier_before,
        tier_after=r.tier_after,
        rank=r.rank,
        moved=r.moved,  # type: ignore[arg-type]
        weekly_xp=r.xp,
        members=r.members,
    )


async def _profile(principal: CurrentPrincipal, session: DbSession) -> Profile:
    profile = await LearnerRepository(session).profile(principal.learner_id)
    if profile is None:
        raise InvalidToken("This account no longer exists.")
    return profile


@router.get(
    "/leagues/current",
    summary="This week's league: the group, the learner's tier, and an unseen result",
    responses=problem_responses(401, 429, 503),
)
async def current_league(
    principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> LeagueStatusOut:
    async with session.begin():
        profile = await _profile(principal, session)
        s = await LeagueService(session, container.clock).status(principal.learner_id, profile)
    return LeagueStatusOut(
        opted_in=s.opted_in,
        eligible=s.eligible,
        tier=s.tier,
        week_starts_at=s.week.starts_at,
        week_ends_at=s.week.ends_at,
        league=(
            LeagueOut(
                id=s.table.id,
                tier=s.table.tier,
                members=[
                    LeagueRow(
                        rank=r.rank,
                        display_name=r.display_name,
                        weekly_xp=r.xp,
                        you=r.you,
                        zone=r.zone,  # type: ignore[arg-type]
                    )
                    for r in s.table.rows
                ],
            )
            if s.table
            else None
        ),
        result=result_out(s.result) if s.result else None,
    )


@router.get(
    "/leagues/history",
    summary="The learner's settled weeks, newest first",
    responses=problem_responses(401, 422, 429, 503),
)
async def league_history(
    principal: CurrentPrincipal,
    session: DbSession,
    container: ContainerDep,
    cursor: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int, Query(ge=1, le=52)] = 12,
) -> LeagueHistoryOut:
    before = None
    if cursor is not None:
        try:
            before = datetime.fromisoformat(cursor)
        except ValueError:
            raise ValidationFailed([FieldError("cursor", "not a cursor from this list")]) from None
        if before.tzinfo is None:
            raise ValidationFailed([FieldError("cursor", "not a cursor from this list")])
    async with session.begin():
        service = LeagueService(session, container.clock)
        await service.catch_up(principal.learner_id)
        weeks, nxt = await service.history(principal.learner_id, before, limit)
    return LeagueHistoryOut(
        weeks=[result_out(w) for w in weeks],
        next_cursor=nxt.isoformat() if nxt else None,
    )


@router.post(
    "/leagues/result-seen",
    status_code=204,
    response_class=Response,
    summary="The week's result was shown; stop returning it",
    responses=problem_responses(401, 429, 503),
)
async def league_result_seen(
    principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> Response:
    async with session.begin():
        await LeagueService(session, container.clock).mark_result_seen(principal.learner_id)
    return Response(status_code=204)
