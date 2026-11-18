"""/health, /ready and /metrics against real and deliberately unreachable dependencies."""

from __future__ import annotations

import socket
import time

import httpx
import pytest
from pydantic import SecretStr

from app.config import Settings
from tests.integration.api import register
from tests.integration.conftest import start_app

pytestmark = pytest.mark.integration


def _closed_port() -> int:
    """A local port with nothing listening on it: connections are refused at once."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
    return port


async def test_health_answers_without_touching_dependencies(client: httpx.AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_ready_when_postgres_and_redis_answer(client: httpx.AsyncClient) -> None:
    response = await client.get("/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"] == {"postgres": "ok", "redis": "ok", "content": "ok"}
    assert body["content_version"].startswith("sha256:")


async def test_ready_fails_fast_when_postgres_is_down(settings: Settings) -> None:
    down = settings.model_copy(update={"db_host": "127.0.0.1", "db_port": _closed_port()})
    async with start_app(down) as running:
        started = time.perf_counter()
        response = await running.client.get("/ready")
        elapsed = time.perf_counter() - started

    assert response.status_code == 503
    body = response.json()
    assert body["type"] == "not_ready"
    assert body["checks"] == {"postgres": "fail", "redis": "ok", "content": "ok"}
    assert response.headers["retry-after"] == "5"
    assert elapsed < 3


async def test_ready_fails_when_redis_is_down(settings: Settings) -> None:
    down = settings.model_copy(update={"redis_host": "127.0.0.1", "redis_port": _closed_port()})
    async with start_app(down) as running:
        response = await running.client.get("/ready")
    assert response.status_code == 503
    assert response.json()["checks"] == {"postgres": "ok", "redis": "fail", "content": "ok"}


async def test_a_request_that_needs_the_database_gets_503_while_it_is_down(
    settings: Settings,
) -> None:
    down = settings.model_copy(update={"db_host": "127.0.0.1", "db_port": _closed_port()})
    async with start_app(down) as running:
        response = await register(running.client)
        health = await running.client.get("/health")
    assert response.status_code == 503
    assert response.json()["type"] == "dependency_unavailable"
    assert health.status_code == 200  # liveness is unaffected: restarting would not help


async def test_metrics_expose_red_metrics_and_the_database_pool(client: httpx.AsyncClient) -> None:
    await client.get("/health")
    response = await client.get("/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    text = response.text
    assert 'http_requests_total{method="GET",route="/health",status="200"}' in text
    assert "http_request_duration_seconds_bucket" in text
    assert 'db_pool_connections{state="checked_out"}' in text


async def test_metrics_require_the_token_when_one_is_configured(settings: Settings) -> None:
    token = "scrape-" + "x" * 32
    guarded = settings.model_copy(update={"metrics_token": SecretStr(token)})
    async with start_app(guarded) as running:
        refused = await running.client.get("/metrics")
        allowed = await running.client.get("/metrics", headers={"Authorization": f"Bearer {token}"})
    assert refused.status_code == 401
    assert allowed.status_code == 200
