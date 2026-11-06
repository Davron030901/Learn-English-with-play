"""Domain errors and their RFC 9457 ``application/problem+json`` rendering.

Every error response in the API has one shape::

    {"type": "email_taken", "title": "Email already registered", "status": 409,
     "detail": "...", "instance": "/v1/auth/register", "request_id": "..."}

``type`` is a stable slug per error (a relative URI reference in RFC 9457 terms)
that clients may branch on; ``title`` and ``detail`` are for humans and may change.
Nothing in a problem body ever echoes a submitted value back, a stack trace, or SQL.
"""

from __future__ import annotations

import errno
import socket
from collections.abc import Mapping
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any, ClassVar

import asyncpg
import redis.exceptions
import sqlalchemy.exc
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_MEDIA_TYPE = "application/problem+json"


@dataclass(frozen=True, slots=True)
class FieldError:
    field: str
    message: str

    def as_dict(self) -> dict[str, str]:
        return {"field": self.field, "message": self.message}


class AppError(Exception):
    """Base class. Subclasses fix ``status``, ``type`` and ``title``."""

    status: ClassVar[int] = 500
    type: ClassVar[str] = "internal_error"
    title: ClassVar[str] = "Internal server error"
    default_headers: ClassVar[Mapping[str, str]] = {}

    def __init__(
        self,
        detail: str | None = None,
        *,
        headers: Mapping[str, str] | None = None,
        **extensions: Any,
    ) -> None:
        super().__init__(detail or self.title)
        self.detail = detail
        self.headers = {**self.default_headers, **(headers or {})}
        self.extensions = extensions


class ValidationFailed(AppError):
    status = 422
    type = "validation_error"
    title = "Validation failed"

    def __init__(self, errors: list[FieldError], detail: str = "Some fields are invalid") -> None:
        super().__init__(detail, errors=[error.as_dict() for error in errors])


class PasswordRefused(AppError):
    """A new password that should not be chosen (R14). ``reason`` is a stable slug —
    ``common``, ``pattern``, ``context``, ``breached`` or ``unchanged`` — for the app's own copy;
    ``errors`` names the field, as a validation error would."""

    status = 422
    type = "password_refused"
    title = "Choose another password"

    def __init__(self, field: str, reason: str, message: str) -> None:
        super().__init__(message, reason=reason, errors=[FieldError(field, message).as_dict()])


class AgeRequirementNotMet(AppError):
    status = 422
    type = "age_requirement_not_met"
    title = "Age requirement not met"


class Unauthorized(AppError):
    status = 401
    type = "unauthorized"
    title = "Authentication required"
    default_headers = {"WWW-Authenticate": "Bearer"}


class InvalidCredentials(Unauthorized):
    type = "invalid_credentials"
    title = "Invalid email or password"


class InvalidToken(Unauthorized):
    type = "invalid_token"
    title = "Invalid or expired token"
    default_headers = {"WWW-Authenticate": 'Bearer error="invalid_token"'}


class SessionRevoked(Unauthorized):
    type = "session_revoked"
    title = "Session has been revoked"
    default_headers = {"WWW-Authenticate": 'Bearer error="invalid_token"'}


class NotFound(AppError):
    status = 404
    type = "not_found"
    title = "Not found"


class Conflict(AppError):
    status = 409
    type = "conflict"
    title = "Conflict"


class EmailAlreadyRegistered(Conflict):
    type = "email_taken"
    title = "Email already registered"


class StreakRuleRefused(Conflict):
    """A streak request the rules do not allow (repair window passed, already paused, …)."""

    type = "streak_rule"
    title = "Not possible for this streak"


class PayloadTooLarge(AppError):
    status = 413
    type = "payload_too_large"
    title = "Payload too large"


class RateLimited(AppError):
    status = 429
    type = "rate_limited"
    title = "Too many requests"

    def __init__(self, retry_after_s: int) -> None:
        super().__init__(
            f"Try again in {retry_after_s} s.",
            headers={"Retry-After": str(retry_after_s)},
            retry_after_s=retry_after_s,
        )


class DependencyUnavailable(AppError):
    status = 503
    type = "dependency_unavailable"
    title = "Service temporarily unavailable"
    default_headers = {"Retry-After": "5"}


class InternalError(AppError):
    pass


_STATUS_TYPES: Mapping[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    406: "not_acceptable",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    429: "rate_limited",
}

#: Exception types that mean PostgreSQL or Redis is unreachable, overloaded or restarting.
DEPENDENCY_ERRORS: tuple[type[Exception], ...] = (
    ConnectionError,
    TimeoutError,
    socket.gaierror,
    sqlalchemy.exc.OperationalError,
    sqlalchemy.exc.InterfaceError,
    sqlalchemy.exc.TimeoutError,
    redis.exceptions.ConnectionError,
    redis.exceptions.TimeoutError,
    asyncpg.exceptions.PostgresConnectionError,
    asyncpg.exceptions.CannotConnectNowError,
    asyncpg.exceptions.TooManyConnectionsError,
    asyncpg.exceptions.AdminShutdownError,
    asyncpg.exceptions.QueryCanceledError,
    asyncpg.exceptions.ConnectionDoesNotExistError,
)
_UNREACHABLE_ERRNOS = frozenset(
    {errno.ECONNREFUSED, errno.ETIMEDOUT, errno.EHOSTUNREACH, errno.ENETUNREACH}
)


#: SQLSTATEs meaning the server is overloaded, restarting or cancelled the statement
#: (statement timeout, admin shutdown, crash shutdown, cannot connect now, too many
#: connections). Class 08 (connection exceptions) is matched by prefix. Deadlocks (40P01)
#: and serialization failures (40001) are deliberately absent: they belong to a
#: transaction-retry path, not to a 503.
_DEPENDENCY_SQLSTATES = frozenset({"57014", "57P01", "57P02", "57P03", "53300"})


def _wrapped_database_failure(exc: sqlalchemy.exc.DBAPIError) -> bool:
    """SQLAlchemy wraps asyncpg's errors in a plain ``DBAPIError`` whose ``orig`` is the
    adapter's generic error; the asyncpg exception is that error's ``__cause__``."""
    if exc.connection_invalidated:
        return True
    orig = exc.orig
    cause = getattr(orig, "__cause__", None)
    if isinstance(orig, DEPENDENCY_ERRORS) or isinstance(cause, DEPENDENCY_ERRORS):
        return True
    for candidate in (orig, cause):
        code = getattr(candidate, "sqlstate", None)
        if isinstance(code, str) and (code in _DEPENDENCY_SQLSTATES or code.startswith("08")):
            return True
    return False


def is_dependency_failure(exc: BaseException) -> bool:
    """True when PostgreSQL or Redis could not be reached or answered too slowly.

    asyncpg raises plain ``OSError`` from connect, for example
    ``OSError("Multiple exceptions: ...")`` when every address of a host refuses; errors
    raised *during* a query arrive wrapped in ``sqlalchemy.exc.DBAPIError``.
    """
    if isinstance(exc, DEPENDENCY_ERRORS):
        return True
    if isinstance(exc, sqlalchemy.exc.DBAPIError) and _wrapped_database_failure(exc):
        return True
    if isinstance(exc, OSError):
        return exc.errno in _UNREACHABLE_ERRNOS or str(exc).startswith("Multiple exceptions")
    return False


def problem_body(
    *,
    status: int,
    type_: str,
    title: str,
    detail: str | None,
    instance: str | None,
    request_id: str | None,
    extensions: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"type": type_, "title": title, "status": status}
    if detail:
        body["detail"] = detail
    if instance:
        body["instance"] = instance
    if request_id:
        body["request_id"] = request_id
    if extensions:
        body.update(extensions)
    return body


def problem_response(
    error: AppError, *, instance: str | None, request_id: str | None
) -> JSONResponse:
    return JSONResponse(
        problem_body(
            status=error.status,
            type_=error.type,
            title=error.title,
            detail=error.detail,
            instance=instance,
            request_id=request_id,
            extensions=error.extensions,
        ),
        status_code=error.status,
        headers=error.headers,
        media_type=PROBLEM_MEDIA_TYPE,
    )


def _request_id(request: Request) -> str | None:
    value = request.scope.get("state", {}).get("request_id")
    return value if isinstance(value, str) else None


def _field_name(loc: tuple[int | str, ...]) -> str:
    parts = [str(part) for part in loc]
    if parts and parts[0] in ("body", "query", "path", "header", "cookie"):
        parts = parts[1:]
    return ".".join(parts) or "body"


async def _handle_app_error(request: Request, exc: Exception) -> JSONResponse:
    error = exc if isinstance(exc, AppError) else InternalError()
    return problem_response(error, instance=request.url.path, request_id=_request_id(request))


async def _handle_validation_error(request: Request, exc: Exception) -> JSONResponse:
    raw = exc.errors() if isinstance(exc, RequestValidationError) else []
    # Only the location and the message: pydantic's error also carries the submitted
    # input, which for a login form is the password.
    errors = [
        FieldError(_field_name(tuple(error.get("loc", ()))), str(error.get("msg", "invalid")))
        for error in raw
    ]
    return problem_response(
        ValidationFailed(errors), instance=request.url.path, request_id=_request_id(request)
    )


async def _handle_http_exception(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, StarletteHTTPException):
        return await _handle_app_error(request, exc)
    phrase = HTTPStatus(exc.status_code).phrase
    detail = exc.detail if isinstance(exc.detail, str) and exc.detail != phrase else None
    return JSONResponse(
        problem_body(
            status=exc.status_code,
            type_=_STATUS_TYPES.get(exc.status_code, f"http_{exc.status_code}"),
            title=phrase,
            detail=detail,
            instance=request.url.path,
            request_id=_request_id(request),
        ),
        status_code=exc.status_code,
        headers=dict(exc.headers or {}),
        media_type=PROBLEM_MEDIA_TYPE,
    )


def install_exception_handlers(app: FastAPI) -> None:
    """Map known errors to problems. Anything else is caught by RequestContextMiddleware."""
    app.add_exception_handler(AppError, _handle_app_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
