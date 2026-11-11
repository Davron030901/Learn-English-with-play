"""Liveness, readiness and metrics. Not versioned and not rate limited."""

from __future__ import annotations

import asyncio
import hmac
from collections.abc import Awaitable

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST
from sqlalchemy import text

from app.container import AppContainer
from app.deps import ContainerDep
from app.errors import PROBLEM_MEDIA_TYPE, Unauthorized, problem_body
from app.observability.logs import get_logger
from app.schemas.problem import problem_responses

#: Each dependency check must answer within this, so a hung database cannot hang the probe.
READY_CHECK_TIMEOUT_S = 2.0

router = APIRouter(tags=["operations"])
_log = get_logger("app.health")


@router.get("/health", summary="Liveness: the process is up")
async def health() -> dict[str, str]:
    return {"status": "ok"}


async def _postgres_ok(container: AppContainer) -> bool:
    async with asyncio.timeout(READY_CHECK_TIMEOUT_S), container.engine.connect() as connection:
        await connection.execute(text("SELECT 1"))
    return True


async def _redis_ok(container: AppContainer) -> bool:
    async with asyncio.timeout(READY_CHECK_TIMEOUT_S):
        return bool(await container.redis.ping())


async def _check(name: str, probe: Awaitable[bool]) -> tuple[str, bool]:
    try:
        return name, await probe
    except Exception as exc:  # noqa: BLE001 - any failure means "not ready"
        _log.warning("readiness_check_failed", check=name, error_type=type(exc).__name__)
        return name, False


@router.get(
    "/ready",
    summary="Readiness: PostgreSQL and Redis answer",
    responses=problem_responses(503),
)
async def ready(request: Request, container: ContainerDep) -> JSONResponse:
    results = await asyncio.gather(
        _check("postgres", _postgres_ok(container)),
        _check("redis", _redis_ok(container)),
    )
    checks = {name: "ok" if ok else "fail" for name, ok in results}
    # The course is loaded before the app accepts traffic and never changes afterwards; the
    # check names it so an operator sees which content version an instance serves.
    checks["content"] = "ok" if container.content.items else "fail"
    if all(v == "ok" for v in checks.values()):
        return JSONResponse(
            {"status": "ready", "checks": checks, "content_version": container.content.version}
        )
    return JSONResponse(
        problem_body(
            status=503,
            type_="not_ready",
            title="Service not ready",
            detail="A dependency did not answer the readiness check.",
            instance=request.url.path,
            request_id=request.scope.get("state", {}).get("request_id"),
            extensions={"checks": checks},
        ),
        status_code=503,
        media_type=PROBLEM_MEDIA_TYPE,
        headers={"Retry-After": "5"},
    )


@router.get("/metrics", include_in_schema=False)
async def metrics(request: Request, container: ContainerDep) -> Response:
    token = container.settings.metrics_token
    if token is not None:
        presented = request.headers.get("authorization", "").encode()
        expected = f"Bearer {token.get_secret_value()}".encode()
        if not hmac.compare_digest(presented, expected):
            raise Unauthorized("Scraping /metrics requires the metrics bearer token.")
    return Response(container.metrics.render(), media_type=CONTENT_TYPE_LATEST)
