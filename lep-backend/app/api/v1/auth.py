"""POST /v1/auth/register · /login · /refresh · /logout · /password/forgot · /password/reset.

**The web's refresh token** (frontend DECISIONS F8). A browser has no secure store, so with
``LEP_WEB_REFRESH_COOKIE`` on, a client that sends ``X-LEP-Token-Transport: cookie`` gets its
refresh token as an ``httpOnly``, ``Secure``, ``SameSite=Strict`` ``__Host-`` cookie — script on
the page can never read it, and no other host can set one — and ``refresh_token: null`` in the
body. Every tab of a browser shares it, so the web client must serialise refreshes across tabs
(reuse detection is strict, DECISIONS §2.6). ``/refresh`` and
``/logout`` then read it from the cookie. Against forged requests: the cookie is never sent
cross-site (``SameSite=Strict``), the custom header cannot be sent by a form and forces a CORS
preflight, and an ``Origin`` that is neither this API's nor in ``LEP_CORS_ORIGINS`` is refused.
Every other route still authenticates with the bearer access token only; no cookie is read.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Annotated, Final

from fastapi import APIRouter, BackgroundTasks, Depends, Form, Request, Response
from pydantic import SecretStr

from app.api.v1.presenters import learner_out, token_response
from app.container import AppContainer
from app.deps import (
    AuthServiceDep,
    ContainerDep,
    DbSession,
    PasswordServiceDep,
    limit_login_ip,
    limit_password_reset_ip,
    limit_refresh_ip,
    limit_register_ip,
)
from app.errors import AppError, FieldError, InternalError, ValidationFailed
from app.repositories.learners import LearnerRepository
from app.schemas.auth import (
    LoginForm,
    LogoutRequest,
    PasswordForgotOut,
    PasswordForgotRequest,
    PasswordResetRequest,
    RefreshRequest,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
    normalise_login_email,
    rate_limit_key_for_email,
)
from app.schemas.problem import problem_responses
from app.services.auth import IssuedTokens, Registration
from app.services.passwords import ResetLinkInvalid, ResetPolicy, send_reset_link

router = APIRouter(prefix="/auth", tags=["auth"])

#: RFC 6749 §5.1: token responses must not be cached anywhere.
_NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}

#: ``__Host-``: Secure, no Domain, Path=/ — a sibling host on the same site cannot plant a
#: cookie of this name for the API to read (cookie tossing). Only /refresh and /logout read it.
REFRESH_COOKIE: Final = "__Host-lep_refresh"
REFRESH_COOKIE_PATH: Final = "/"
TRANSPORT_HEADER: Final = "X-LEP-Token-Transport"


class OriginRefused(AppError):
    status = 403
    type = "origin_refused"
    title = "This origin may not use the refresh cookie"


class PasswordResetUnavailable(AppError):
    status = 503
    type = "password_reset_unavailable"
    title = "Password reset by email is not available"


class ResetLinkInvalidError(AppError):
    status = 400
    type = "reset_link_invalid"
    title = "This reset link does not work any more"


def _cookie_mode(request: Request, container: AppContainer) -> bool:
    """True when this request asked for the refresh cookie and may have it."""
    settings = container.settings
    if not settings.web_refresh_cookie:
        return False
    if request.headers.get(TRANSPORT_HEADER, "").strip().lower() != "cookie":
        return False
    origin = request.headers.get("origin")
    if origin is not None:
        own = f"{request.url.scheme}://{request.url.netloc}"
        if origin.rstrip("/") not in (own, *settings.cors_origins):
            raise OriginRefused("Sign in from the app's own address.")
    return True


def _issue(
    response: Response, issued: IssuedTokens, container: AppContainer, *, cookie: bool
) -> TokenResponse:
    now = container.clock.now()
    response.headers.update(_NO_STORE)
    body = token_response(issued, now=now)
    if not cookie:
        return body
    response.set_cookie(
        REFRESH_COOKIE,
        issued.refresh_token,
        max_age=body.refresh_expires_in,
        path=REFRESH_COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="strict",
    )
    return body.model_copy(update={"refresh_token": None})


def _clear_cookie(response: Response) -> None:
    response.delete_cookie(
        REFRESH_COOKIE, path=REFRESH_COOKIE_PATH, secure=True, httponly=True, samesite="strict"
    )


def _presented(body_token: SecretStr | None, request: Request, *, cookie: bool) -> SecretStr:
    """The refresh token: the body's, else (cookie mode) the cookie's."""
    if body_token is not None:
        return body_token
    if cookie and request.cookies.get(REFRESH_COOKIE):
        return SecretStr(request.cookies[REFRESH_COOKIE])
    raise ValidationFailed([FieldError("refresh_token", "a refresh token is required")])


@router.post(
    "/register",
    status_code=201,
    summary="Create an account and sign in",
    dependencies=[Depends(limit_register_ip)],
    responses=problem_responses(403, 409, 422, 429, 503),
)
async def register(
    body: RegisterRequest,
    request: Request,
    response: Response,
    container: ContainerDep,
    service: AuthServiceDep,
    session: DbSession,
) -> RegisterResponse:
    cookie = _cookie_mode(request, container)
    issued = await service.register(
        Registration(
            email=body.email,
            password=body.password,
            l1=body.l1,
            birth_year=body.birth_year,
            tz=body.tz,
            daily_goal_min=body.daily_goal_min,
            spelling_variant=body.spelling_variant,
        ),
        user_agent=request.headers.get("user-agent"),
    )
    async with session.begin():
        profile = await LearnerRepository(session).profile(issued.learner_id)
    if profile is None:
        raise InternalError("The new account could not be read back.")
    tokens = _issue(response, issued, container, cookie=cookie)
    response.headers["Location"] = "/v1/me"
    return RegisterResponse(
        learner=learner_out(profile, today=container.clock.now().date()), tokens=tokens
    )


@router.post(
    "/login",
    summary="Sign in (OAuth 2.0 password grant, form-encoded)",
    dependencies=[Depends(limit_login_ip)],
    responses=problem_responses(401, 403, 422, 429, 503),
)
async def login(
    form: Annotated[LoginForm, Form()],
    request: Request,
    response: Response,
    container: ContainerDep,
    service: AuthServiceDep,
) -> TokenResponse:
    cookie = _cookie_mode(request, container)
    email = normalise_login_email(form.username)
    await container.rate_limiter.enforce(
        container.limits.login_account, rate_limit_key_for_email(email), fail_open=False
    )
    issued = await service.login(email, form.password, user_agent=request.headers.get("user-agent"))
    return _issue(response, issued, container, cookie=cookie)


@router.post(
    "/refresh",
    summary="Exchange a refresh token for a new token pair (rotation)",
    dependencies=[Depends(limit_refresh_ip)],
    responses=problem_responses(401, 403, 422, 429, 503),
)
async def refresh(
    request: Request,
    response: Response,
    container: ContainerDep,
    service: AuthServiceDep,
    body: RefreshRequest | None = None,
) -> TokenResponse:
    cookie = _cookie_mode(request, container)
    presented = _presented(body.refresh_token if body else None, request, cookie=cookie)
    issued = await service.refresh(presented)
    return _issue(response, issued, container, cookie=cookie)


@router.post(
    "/logout",
    status_code=204,
    response_class=Response,
    summary="End the session that owns this refresh token",
    dependencies=[Depends(limit_refresh_ip)],
    responses=problem_responses(403, 422, 429, 503),
)
async def logout(
    request: Request,
    container: ContainerDep,
    service: AuthServiceDep,
    body: LogoutRequest | None = None,
) -> Response:
    cookie = _cookie_mode(request, container)
    out = Response(status_code=204)
    if cookie:
        _clear_cookie(out)
        if body is None and not request.cookies.get(REFRESH_COOKIE):
            return out  # nothing to end: the browser held no session
    presented = _presented(body.refresh_token if body else None, request, cookie=cookie)
    await service.logout(presented)
    return out


# ------------------------------------------------------------------- forgotten passwords


@router.post(
    "/password/forgot",
    status_code=202,
    summary="Email a link to set a new password (the answer is the same for any address)",
    dependencies=[Depends(limit_password_reset_ip)],
    responses=problem_responses(422, 429, 503),
)
async def forgot_password(
    body: PasswordForgotRequest,
    background: BackgroundTasks,
    container: ContainerDep,
) -> PasswordForgotOut:
    settings = container.settings
    mailer = container.mailer
    if mailer is None or settings.password_reset_url is None:
        raise PasswordResetUnavailable(
            "Resetting a password by email is not set up on this server."
        )
    email = normalise_login_email(body.email)
    await container.rate_limiter.enforce(
        container.limits.password_reset_account, rate_limit_key_for_email(email), fail_open=False
    )
    policy = ResetPolicy(
        url=settings.password_reset_url, ttl=timedelta(seconds=settings.password_reset_ttl_s)
    )
    background.add_task(
        send_reset_link,
        container.sessionmaker,
        mailer,
        container.clock,
        container.metrics,
        policy,
        email,
    )
    return PasswordForgotOut(expires_in_minutes=settings.password_reset_ttl_s // 60)


@router.post(
    "/password/reset",
    status_code=204,
    response_class=Response,
    summary="Set a new password from an emailed link; every session of the account ends",
    dependencies=[Depends(limit_login_ip)],
    responses=problem_responses(400, 422, 429, 503),
)
async def reset_password(body: PasswordResetRequest, service: PasswordServiceDep) -> Response:
    try:
        await service.reset(body.token, body.new_password)
    except ResetLinkInvalid:
        raise ResetLinkInvalidError(
            "The link is used, has expired or was replaced by a newer one; ask for a new one."
        ) from None
    return Response(status_code=204, headers=_NO_STORE)
