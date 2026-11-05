"""Request context: id, logging, metrics, body limit, and the last-resort error handler.

For every HTTP request this middleware

1. assigns a request id, accepting a well-formed incoming ``X-Request-ID``, binds it
   into structlog contextvars so every log line of the request carries it, and returns
   it in the ``X-Request-ID`` response header and in every problem body;
2. refuses a body larger than ``LEP_MAX_BODY_BYTES`` with 413, by declared length or by
   counting a chunked body as it streams;
3. records RED metrics by route template and writes one access-log line;
4. turns any exception that escaped the application into a problem response — 503 when
   PostgreSQL or Redis was unreachable, otherwise a generic 500 — and logs it with its
   traceback. It never re-raises, so the server never prints an uncorrelated traceback.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

import structlog
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.errors import (
    AppError,
    DependencyUnavailable,
    InternalError,
    PayloadTooLarge,
    is_dependency_failure,
    problem_response,
)
from app.ids import uuid7
from app.observability.logs import get_logger
from app.observability.metrics import Metrics

REQUEST_ID_HEADER = "x-request-id"
UNMATCHED_ROUTE = "__unmatched__"
#: Letters, digits and ``._:-``, 8–128 characters: long enough to be unique, and safe
#: to write into a log line or a header without escaping.
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
#: Probes and scrapes are logged at DEBUG so they do not drown the access log.
_QUIET_PATHS = frozenset({"/health", "/ready", "/metrics"})

_log = get_logger("app.http")


def incoming_request_id(scope: Scope) -> str | None:
    """The client's ``X-Request-ID`` if it is well formed, otherwise None."""
    for name, value in scope.get("headers", ()):
        if name == b"x-request-id":
            candidate: str = value.decode("latin-1")
            return candidate if _VALID_REQUEST_ID.fullmatch(candidate) else None
    return None


def _declared_length(scope: Scope) -> int | None:
    for name, value in scope.get("headers", ()):
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


def route_template(scope: Scope) -> str:
    """The matched route's full path template, e.g. ``/v1/auth/register``.

    FastAPI includes routers lazily, so ``scope["route"].path`` is relative to the
    router ("/auth/register"); the full template is on the effective route context.
    tests/integration/test_observability.py pins this, so a FastAPI upgrade that moves
    it fails the build instead of silently relabelling every metric.
    """
    fastapi_scope = scope.get("fastapi")
    effective = (
        fastapi_scope.get("effective_route_context") if isinstance(fastapi_scope, dict) else None
    )
    path = getattr(effective, "path", None) or getattr(scope.get("route"), "path", None)
    return path if isinstance(path, str) else UNMATCHED_ROUTE


@dataclass(slots=True)
class _ResponseState:
    status: int = 500
    started: bool = False


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp, *, metrics: Metrics, max_body_bytes: int) -> None:
        self.app = app
        self.metrics = metrics
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = incoming_request_id(scope) or uuid7().hex
        scope.setdefault("state", {})["request_id"] = request_id
        method: str = scope["method"]
        path: str = scope["path"]
        state = _ResponseState()
        received = 0

        async def send_with_context(message: Message) -> None:
            if message["type"] == "http.response.start":
                state.status = message["status"]
                state.started = True
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        async def receive_with_limit() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    # An HTTPException, because FastAPI turns any other error raised
                    # while it parses a body into a 400.
                    raise StarletteHTTPException(status_code=413)
            return message

        started = time.perf_counter()
        self.metrics.http_in_flight.inc()
        with structlog.contextvars.bound_contextvars(request_id=request_id):
            try:
                declared = _declared_length(scope)
                if declared is not None and declared > self.max_body_bytes:
                    await self._send_problem(self._too_large(), scope, receive, send_with_context)
                else:
                    await self.app(scope, receive_with_limit, send_with_context)
            except Exception as exc:  # noqa: BLE001 - this is the last-resort handler
                error = self._classify(exc)
                if not state.started:
                    await self._send_problem(error, scope, receive, send_with_context)
            finally:
                elapsed = time.perf_counter() - started
                self.metrics.http_in_flight.dec()
                route = route_template(scope)
                self.metrics.observe_request(
                    method=method, route=route, status=state.status, seconds=elapsed
                )
                emit = _log.debug if path in _QUIET_PATHS else _log.info
                client = scope.get("client")
                emit(
                    "http_request",
                    method=method,
                    path=path,
                    route=route,
                    status=state.status,
                    duration_ms=round(elapsed * 1000, 2),
                    client_ip=client[0] if client else None,
                )

    def _too_large(self) -> PayloadTooLarge:
        return PayloadTooLarge(f"The request body must not exceed {self.max_body_bytes} bytes.")

    def _classify(self, exc: Exception) -> AppError:
        if isinstance(exc, StarletteHTTPException) and exc.status_code == 413:
            return self._too_large()
        if is_dependency_failure(exc):
            self.metrics.dependency_failures.inc()
            orig = getattr(exc, "orig", None)
            _log.warning(
                "dependency_unavailable",
                error_type=type(exc).__name__,
                sqlstate=getattr(orig, "sqlstate", None)
                or getattr(getattr(orig, "__cause__", None), "sqlstate", None),
            )
            return DependencyUnavailable("A backing service is unavailable; please retry shortly.")
        _log.error("unhandled_exception", exc_info=exc)
        return InternalError("An unexpected error occurred.")

    @staticmethod
    async def _send_problem(error: AppError, scope: Scope, receive: Receive, send: Send) -> None:
        response = problem_response(
            error, instance=scope["path"], request_id=scope["state"]["request_id"]
        )
        await response(scope, receive, send)
