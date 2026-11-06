"""Application factory.

Run with uvicorn's factory mode::

    uvicorn app.main:create_app --factory --proxy-headers --no-access-log

``create_app`` loads configuration from the environment and exits with status 78
(EX_CONFIG) and a one-line JSON error if it is incomplete. Tests call ``build_app``
with an explicit ``Settings``.

Shutdown: on SIGTERM uvicorn stops accepting connections and waits (up to
``--timeout-graceful-shutdown``) for in-flight requests to finish; only then does the
lifespan below close the Redis and database pools, so no in-flight write is cut off.
"""

from __future__ import annotations

import json
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from app import __version__
from app.api import health
from app.api.v1.router import router as v1_router
from app.clock import Clock, SystemClock
from app.config import ConfigError, Settings, load_settings
from app.container import build_container, close_container
from app.errors import PROBLEM_MEDIA_TYPE, install_exception_handlers
from app.middleware.request_context import RequestContextMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.observability.logs import configure_logging, get_logger
from app.observability.metrics import Metrics
from app.observability.tracing import setup_tracing

EX_CONFIG = 78
_DESCRIPTION = (
    "Backend for Learn English with Play. Errors are RFC 9457 problem documents "
    "(`application/problem+json`) whose `type` is a stable slug; every response carries "
    "`X-Request-ID`."
)


class LepFastAPI(FastAPI):
    """FastAPI with an OpenAPI document that states the real error media type."""

    def openapi(self) -> dict[str, Any]:
        if self.openapi_schema:
            return self.openapi_schema
        schema = get_openapi(
            title=self.title,
            version=self.version,
            description=self.description,
            routes=self.routes,
        )
        _document_problem_media_type(schema)
        self.openapi_schema = schema
        return schema


def _document_problem_media_type(schema: dict[str, Any]) -> None:
    """Error responses are sent as application/problem+json, and FastAPI's generic
    422 schema is replaced by the Problem schema the API actually returns."""
    for path_item in schema.get("paths", {}).values():
        for operation in path_item.values():
            for status, response in operation.get("responses", {}).items():
                content = response.get("content")
                if not status.isdigit() or int(status) < 400 or not content:
                    continue
                body = content.pop("application/json", None)
                if body is None:
                    continue
                if body.get("schema", {}).get("$ref", "").endswith("/HTTPValidationError"):
                    body = {"schema": {"$ref": "#/components/schemas/Problem"}}
                content[PROBLEM_MEDIA_TYPE] = body
    components = schema.get("components", {}).get("schemas", {})
    text = json.dumps(schema.get("paths", {}))
    for unused in ("HTTPValidationError", "ValidationError"):
        if f'/{unused}"' not in text and unused in components:
            del components[unused]


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    log = get_logger("app.lifespan")
    container = await build_container(settings, app.state.metrics, app.state.clock)
    app.state.container = container
    log.info("startup_complete", env=settings.env, openapi=settings.openapi_enabled)
    try:
        yield
    finally:
        await close_container(container)
        tracer_provider = app.state.tracer_provider
        if tracer_provider is not None:
            tracer_provider.shutdown()
        log.info("shutdown_complete")


def _middleware(settings: Settings, metrics: Metrics) -> list[Middleware]:
    # First is outermost: security headers and CORS headers then reach every response,
    # including the problems RequestContextMiddleware produces for escaped errors.
    stack = [Middleware(SecurityHeadersMiddleware, hsts=settings.env == "prod")]
    if settings.cors_origins:
        stack.append(
            Middleware(
                CORSMiddleware,
                allow_origins=settings.cors_origins,
                allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
                allow_headers=[
                    "Authorization",
                    "Content-Type",
                    "If-None-Match",
                    "X-Request-ID",
                    "X-LEP-Token-Transport",
                ],
                expose_headers=["ETag", "Retry-After", "X-Request-ID"],
                # credentials only for the web's refresh cookie (F8): it is scoped to /v1/auth,
                # SameSite=Strict, and read only with the X-LEP-Token-Transport header
                allow_credentials=settings.web_refresh_cookie,
                max_age=600,
            )
        )
    stack.append(
        Middleware(
            RequestContextMiddleware, metrics=metrics, max_body_bytes=settings.max_body_bytes
        )
    )
    return stack


def build_app(settings: Settings, *, clock: Clock | None = None) -> FastAPI:
    configure_logging(
        level=settings.log_level, json=settings.log_json, service=settings.service_name
    )
    metrics = Metrics()
    app = LepFastAPI(
        title="Learn English with Play API",
        version=__version__,
        description=_DESCRIPTION,
        lifespan=_lifespan,
        docs_url="/docs" if settings.openapi_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.openapi_enabled else None,
        middleware=_middleware(settings, metrics),
    )
    app.state.settings = settings
    app.state.metrics = metrics
    app.state.clock = clock or SystemClock()
    install_exception_handlers(app)
    app.include_router(health.router)
    app.include_router(v1_router, prefix="/v1")
    app.state.tracer_provider = setup_tracing(app, settings)
    return app


def create_app() -> FastAPI:
    """Uvicorn entry point (``--factory``)."""
    try:
        settings = load_settings(Settings)
    except ConfigError as exc:
        sys.stderr.write(
            json.dumps({"level": "critical", "event": "config_invalid", "detail": str(exc)}) + "\n"
        )
        raise SystemExit(EX_CONFIG) from None
    return build_app(settings)
