"""Composed sessions: what to practise now, in what order (docs/08 §5)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter

from app.deps import ContainerDep, CurrentPrincipal, DbSession
from app.errors import AppError, Conflict, InvalidToken, NotFound
from app.models.sessions import LearnerSession
from app.schemas.problem import problem_responses
from app.schemas.sessions import CatchingUp, SessionOut, SessionRequest, SessionStep
from app.services.sessions import Composed, SessionError, SessionService

router = APIRouter(prefix="/sessions", tags=["sessions"])


class TierLocked(Conflict):
    type = "tier_locked"
    title = "This tier is not open yet"


class NewItemsCapped(Conflict):
    type = "new_items_capped"
    title = "That is today's new material"


def _raise(exc: SessionError) -> AppError:
    detail = str(exc)
    if exc.kind == "tier_locked":
        if exc.available_at is not None:
            return TierLocked(detail, available_at=exc.available_at.isoformat())
        return TierLocked(detail)
    if exc.kind == "new_cap":
        return NewItemsCapped(detail)
    if exc.kind == "gone":
        return InvalidToken(detail)
    return NotFound(detail)


def _out(row: LearnerSession, composed: Composed | None = None) -> SessionOut:
    plan = row.plan
    catching_up = (
        CatchingUp(
            due=composed.backlog.due,
            normal_per_day=composed.backlog.normal,
            days_left=composed.backlog.days_left,
            new_allowed=composed.backlog.new_allowed,
        )
        if composed
        else None
    )
    return SessionOut.model_validate(
        {
            "id": row.id,
            "kind": row.kind,
            "status": row.status,
            "minutes": row.minutes,
            "node_id": row.node_id,
            "tier": row.tier,
            "created_at": row.created_at,
            "completed_at": row.completed_at,
            "estimated_seconds": plan["estimated_seconds"],
            "steps": [SessionStep(**s) for s in plan["steps"]],
            "new_targets": plan["new_targets"],
            "deferred": plan["deferred"],
            "catching_up": catching_up,
            "new_today": composed.new_today if composed else None,
            "new_cap": composed.new_cap if composed else None,
        }
    )


@router.post(
    "",
    status_code=201,
    summary="Compose a session: warm-up, due reviews, new or lesson material, a close",
    responses=problem_responses(401, 404, 409, 422, 429, 503),
)
async def compose(
    body: SessionRequest, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> SessionOut:
    try:
        async with session.begin():
            composed = await SessionService(session, container.content, container.clock).compose(
                principal.learner_id, body.minutes, body.node_id, body.tier
            )
            return _out(composed.row, composed)
    except SessionError as exc:
        raise _raise(exc) from None


@router.get(
    "/{session_id}",
    summary="Resume a composed session",
    responses=problem_responses(401, 404, 429, 503),
)
async def get_session(
    session_id: UUID, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> SessionOut:
    try:
        async with session.begin():
            row = await SessionService(session, container.content, container.clock).get(
                principal.learner_id, session_id
            )
            return _out(row)
    except SessionError as exc:
        raise _raise(exc) from None


@router.post(
    "/{session_id}/complete",
    summary="Close a session (idempotent); what it earned is at /sessions/{id}/summary",
    responses=problem_responses(401, 404, 429, 503),
)
async def complete(
    session_id: UUID, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> SessionOut:
    try:
        async with session.begin():
            row = await SessionService(session, container.content, container.clock).complete(
                principal.learner_id, session_id
            )
            return _out(row)
    except SessionError as exc:
        raise _raise(exc) from None
