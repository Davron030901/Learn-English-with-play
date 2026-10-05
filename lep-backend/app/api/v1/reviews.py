"""POST /v1/sync/reviews and POST /v1/reviews — answers in, graded and scheduled."""

from __future__ import annotations

from collections.abc import Sequence

from fastapi import APIRouter

from app.api.v1.gamification import awards_out
from app.deps import ContainerDep, CurrentPrincipal, DbSession
from app.errors import InvalidToken
from app.repositories.learners import LearnerRepository
from app.repositories.reviews import ReviewRepository
from app.schemas.problem import problem_responses
from app.schemas.reviews import (
    DisputeRecord,
    OutboxRecord,
    RecordResult,
    ReviewRecord,
    SyncRequest,
    SyncResponse,
    Typo,
)
from app.services.gamification import GamificationService
from app.services.reviews import IncomingDispute, IncomingReview, Outcome, ReviewService

router = APIRouter(tags=["reviews"])


def _result(o: Outcome) -> RecordResult:
    return RecordResult(
        client_uuid=o.client_uuid,
        status=o.status,  # type: ignore[arg-type]
        verdict=o.verdict,  # type: ignore[arg-type]
        grade=o.grade,
        typo=Typo(typed=o.typo[0], expected=o.typo[1]) if o.typo else None,
        problem=o.problem,
    )


async def _ingest(
    records: Sequence[OutboxRecord],
    principal: CurrentPrincipal,
    session: DbSession,
    container: ContainerDep,
) -> SyncResponse:
    reviews = [
        IncomingReview(
            client_uuid=r.client_uuid,
            created_at=r.created_at,
            monotonic_ms=r.monotonic_ms,
            item_id=r.payload.item_id,
            session_id=r.payload.session_id,
            submission=r.payload.submission,
            rt_ms=r.payload.rt_ms,
            hints_used=r.payload.hints_used,
            plays_used=r.payload.plays_used,
            content_version=r.payload.content_version,
            local_verdict=r.payload.local_verdict,
        )
        for r in records
        if isinstance(r, ReviewRecord)
    ]
    disputes = [
        IncomingDispute(
            client_uuid=r.client_uuid,
            created_at=r.created_at,
            review_client_uuid=r.payload.review_client_uuid,
            item_id=r.payload.item_id,
        )
        for r in records
        if isinstance(r, DisputeRecord)
    ]
    async with session.begin():
        profile = await LearnerRepository(session).profile(principal.learner_id)
        if profile is None:
            raise InvalidToken("This account no longer exists.")
        service = ReviewService(session, container.content, container.clock)
        outcomes = await service.ingest(
            principal.learner_id,
            tz=profile.tz,
            desired_retention=float(profile.desired_retention),
            reviews=reviews,
            disputes=disputes,
        )
        awards = await GamificationService(session, container.content, container.clock).apply(
            principal.learner_id, profile, outcomes
        )
        now = container.clock.now()
        due = await ReviewRepository(session).due_count(principal.learner_id, now)
    by_id = {o.client_uuid: o for o in outcomes}
    results: list[RecordResult] = []
    seen: set[object] = set()
    for r in records:
        result = _result(by_id[r.client_uuid])
        if r.client_uuid in seen:
            # a second copy in the same request: reported, never written twice
            result = result.model_copy(update={"status": "duplicate"})
        seen.add(r.client_uuid)
        results.append(result)
    return SyncResponse(
        results=results,
        server_time=now,
        due_now=due,
        awards=awards_out(awards),
    )


@router.post(
    "/sync/reviews",
    summary="Replay the outbox: a batch of answers and disputes, idempotent on client_uuid",
    responses=problem_responses(401, 422, 429, 503),
)
async def sync_reviews(
    body: SyncRequest, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> SyncResponse:
    return await _ingest(body.records, principal, session, container)


@router.post(
    "/reviews",
    summary="One answer (or dispute), graded and scheduled now",
    responses=problem_responses(401, 422, 429, 503),
)
async def post_review(
    body: OutboxRecord, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> SyncResponse:
    return await _ingest([body], principal, session, container)
