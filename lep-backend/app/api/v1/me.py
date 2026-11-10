"""GET /v1/me — the signed-in learner's profile and settings; POST /v1/me/password."""

from __future__ import annotations

from fastapi import APIRouter, Response

from app.api.v1.presenters import learner_out
from app.deps import ContainerDep, CurrentPrincipal, DbSession, PasswordServiceDep
from app.errors import InvalidToken
from app.repositories.learners import LearnerRepository
from app.schemas.auth import PasswordChangeRequest, rate_limit_key_for_email
from app.schemas.learner import LearnerOut
from app.schemas.problem import problem_responses

router = APIRouter(tags=["learner"])


@router.get(
    "/me",
    summary="The signed-in learner",
    responses=problem_responses(401, 429, 503),
)
async def get_me(
    principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> LearnerOut:
    async with session.begin():
        profile = await LearnerRepository(session).profile(principal.learner_id)
    if profile is None:
        raise InvalidToken("This account no longer exists.")
    return learner_out(profile, today=container.clock.now().date())


@router.post(
    "/me/password",
    status_code=204,
    response_class=Response,
    summary="Change the password; the sessions on other devices end, this one stays",
    responses=problem_responses(401, 422, 429, 503),
)
async def change_password(
    body: PasswordChangeRequest,
    principal: CurrentPrincipal,
    session: DbSession,
    container: ContainerDep,
    service: PasswordServiceDep,
) -> Response:
    async with session.begin():
        profile = await LearnerRepository(session).profile(principal.learner_id)
    if profile is None:
        raise InvalidToken("This account no longer exists.")
    # the same bucket as signing in, so the current password cannot be guessed here instead
    await container.rate_limiter.enforce(
        container.limits.login_account, rate_limit_key_for_email(profile.email), fail_open=False
    )
    await service.change(
        principal.learner_id, principal.session_id, body.current_password, body.new_password
    )
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
