"""The AI conversation partner: talk with the story's characters (docs/16 E21)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Query, Response

from app.api.v1.gamification import awards_out
from app.deps import ContainerDep, CurrentPrincipal
from app.errors import AppError, Conflict, FieldError, InvalidToken, NotFound, ValidationFailed
from app.schemas.ai import (
    AiStatusOut,
    CastOut,
    CharacterOut,
    ConversationOut,
    FocusItemOut,
    MessageOut,
    RecastOut,
    ScenarioOut,
    StartConversation,
    SubgoalOut,
    SummaryOut,
    TranscriptOut,
    TurnIn,
    TurnOut,
)
from app.schemas.problem import problem_responses
from app.services.ai import AiError, AiService

router = APIRouter(prefix="/ai", tags=["ai"])


class AiUnavailable(AppError):
    status = 503
    type = "ai_unavailable"
    title = "The conversation partner is not available"
    default_headers = {"Retry-After": "10"}


class AiAllowance(Conflict):
    type = "ai_allowance"
    title = "That is today's conversations"


class AiEnded(Conflict):
    type = "ai_ended"
    title = "This conversation has ended"


def _raise(exc: AiError) -> AppError:
    detail = str(exc)
    return {
        "unavailable": AiUnavailable(detail),
        "allowance": AiAllowance(detail),
        "ended": AiEnded(detail),
        "not_found": NotFound(detail),
        "invalid": ValidationFailed([FieldError("text", detail)], detail),
        "gone": InvalidToken(detail),
    }.get(exc.kind, AiUnavailable(detail))


def _service(container: ContainerDep) -> AiService:
    return AiService(
        container.sessionmaker,
        container.content,
        container.clock,
        container.settings,
        container.ai,
    )


@router.get(
    "/status",
    summary="Whether the partner is available, and today's allowance",
    responses=problem_responses(401, 429, 503),
)
async def status(principal: CurrentPrincipal, container: ContainerDep) -> AiStatusOut:
    try:
        s = await _service(container).status(principal.learner_id)
    except AiError as exc:
        raise _raise(exc) from None
    return AiStatusOut(
        available=s.available,
        daily_limit=s.daily_limit,
        used_today=s.used_today,
        max_turns=s.max_turns,
        retention_days=s.retention_days,
    )


@router.get(
    "/characters",
    summary="The characters met by a unit, and scenarios from it and the two before",
    responses=problem_responses(401, 404, 422, 429),
)
async def characters(
    principal: CurrentPrincipal,  # noqa: ARG001 — signed-in learners only
    container: ContainerDep,
    unit_id: str = Query(pattern=r"^S\d{2}U\d{2}$"),
) -> CastOut:
    try:
        cast, scenarios = _service(container).characters(unit_id)
    except AiError as exc:
        raise _raise(exc) from None
    return CastOut(
        characters=[
            CharacterOut(id=c.id, name=c.name, role=c.role, first_unit=c.first_unit, ai=True)
            for c in cast
        ],
        scenarios=[
            ScenarioOut(
                unit_id=s.unit_id,
                cefr=s.cefr,
                title=s.title,
                can_do=s.can_do,
                characters=s.characters,
            )
            for s in scenarios
        ],
    )


@router.post(
    "/conversations",
    status_code=201,
    summary="Start a conversation with a character about a unit's scenario",
    responses=problem_responses(401, 404, 409, 422, 429, 503),
)
async def start(
    body: StartConversation, principal: CurrentPrincipal, container: ContainerDep
) -> ConversationOut:
    try:
        started = await _service(container).start(
            principal.learner_id, body.character_id, body.unit_id, body.mode
        )
    except AiError as exc:
        raise _raise(exc) from None
    return ConversationOut(
        id=started.id,
        character_id=started.character_id,
        unit_id=started.unit_id,
        mode=started.mode,
        opening_line=started.opening_line,
        subgoals=[SubgoalOut(id=g.id, text=g.text) for g in started.subgoals],
        starters=started.starters,
        max_turns=started.max_turns,
        expires_at=started.expires_at,
    )


@router.post(
    "/conversations/{conversation_id}/turns",
    summary="Say something; the character replies (idempotent by client_uuid)",
    responses=problem_responses(401, 404, 409, 422, 429, 503),
)
async def turn(
    conversation_id: UUID, body: TurnIn, principal: CurrentPrincipal, container: ContainerDep
) -> TurnOut:
    try:
        result = await _service(container).turn(
            principal.learner_id, conversation_id, body.client_uuid, body.text, body.rt_ms
        )
    except AiError as exc:
        raise _raise(exc) from None
    return TurnOut(
        reply=result.reply,
        recasts=[
            RecastOut(original=r.original, corrected=r.corrected, start=r.start, end=r.end)
            for r in result.recasts
        ],
        subgoals_met=result.subgoals_met,
        turn=result.turn,
        max_turns=result.max_turns,
        ended=result.ended,
        goal_met=result.goal_met,
        off_limits=result.off_limits,
        awards=awards_out(result.awards),
    )


@router.post(
    "/conversations/{conversation_id}/end",
    summary="End the chat: goal, two things to work on, words used, XP",
    responses=problem_responses(401, 404, 429),
)
async def end(
    conversation_id: UUID, principal: CurrentPrincipal, container: ContainerDep
) -> SummaryOut:
    try:
        s = await _service(container).end(principal.learner_id, conversation_id)
    except AiError as exc:
        raise _raise(exc) from None
    return SummaryOut(
        goal_met=s.goal_met,
        subgoals_met=s.subgoals_met,
        focus_items=[FocusItemOut(**f) for f in s.focus_items],
        words_used=s.words_used,
        xp=s.xp,
        turns=s.turns,
    )


@router.get(
    "/conversations/{conversation_id}",
    summary="The transcript (yours to read or export until it is deleted)",
    responses=problem_responses(401, 404, 429),
)
async def transcript(
    conversation_id: UUID, principal: CurrentPrincipal, container: ContainerDep
) -> TranscriptOut:
    try:
        t = await _service(container).transcript(principal.learner_id, conversation_id)
    except AiError as exc:
        raise _raise(exc) from None
    return TranscriptOut(
        id=t.id,
        character_id=t.character_id,
        unit_id=t.unit_id,
        mode=t.mode,
        status=t.status,
        subgoals=[SubgoalOut(**g) for g in t.subgoals],
        met=t.met,
        turns=t.turns,
        created_at=t.created_at,
        expires_at=t.expires_at,
        messages=[MessageOut(**m) for m in t.messages],
        summary=t.summary,
    )


@router.delete(
    "/conversations/{conversation_id}",
    status_code=204,
    summary="Delete a conversation and its transcript now",
    responses=problem_responses(401, 404, 429),
)
async def delete(
    conversation_id: UUID, principal: CurrentPrincipal, container: ContainerDep
) -> Response:
    try:
        await _service(container).delete(principal.learner_id, conversation_id)
    except AiError as exc:
        raise _raise(exc) from None
    return Response(status_code=204)
