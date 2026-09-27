"""RequestContextMiddleware against a minimal app: no database, no Redis."""

from __future__ import annotations

import io
import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
import pytest
from fastapi import APIRouter, FastAPI, Request
from starlette.middleware import Middleware

from app.errors import PROBLEM_MEDIA_TYPE, install_exception_handlers
from app.middleware.request_context import (
    UNMATCHED_ROUTE,
    RequestContextMiddleware,
    incoming_request_id,
)
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.observability.logs import configure_logging
from app.observability.metrics import Metrics

MAX_BODY = 2_048


@pytest.fixture
def log_stream() -> Iterator[io.StringIO]:
    stream = io.StringIO()
    configure_logging(level="DEBUG", json=True, service="lep-test", stream=stream)
    yield stream
    configure_logging(level="INFO", json=True, service="lep-test")


def _lines(stream: io.StringIO) -> list[dict[str, Any]]:
    return [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]


@pytest.fixture
def metrics() -> Metrics:
    return Metrics()


@pytest.fixture
def app(metrics: Metrics) -> FastAPI:
    app = FastAPI(
        middleware=[
            Middleware(SecurityHeadersMiddleware, hsts=True),
            Middleware(RequestContextMiddleware, metrics=metrics, max_body_bytes=MAX_BODY),
        ]
    )
    install_exception_handlers(app)
    items = APIRouter(prefix="/items")

    @items.get("/{item_id}")
    async def item(item_id: int) -> dict[str, int]:
        return {"item_id": item_id}

    nested = APIRouter()
    nested.include_router(items)
    app.include_router(nested, prefix="/v1")

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("secret internals: SELECT * FROM learners")

    @app.get("/db-down")
    async def db_down() -> None:
        raise ConnectionRefusedError(111, "Connect call failed")

    @app.post("/echo")
    async def echo(request: Request) -> dict[str, int]:
        return {"bytes": len(await request.body())}

    return app


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def test_should_generate_a_request_id_and_return_it(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/items/7")
    assert response.status_code == 200
    assert len(response.headers["x-request-id"]) == 32


async def test_should_keep_a_well_formed_incoming_request_id(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/items/7", headers={"X-Request-ID": "mobile-4f2a9c.001"})
    assert response.headers["x-request-id"] == "mobile-4f2a9c.001"


@pytest.mark.parametrize("bad", ["short", "has space in it", "x" * 129, "evil\nlog-injection"])
def test_should_ignore_malformed_incoming_request_ids(bad: str) -> None:
    scope = {"type": "http", "headers": [(b"x-request-id", bad.encode())]}
    assert incoming_request_id(scope) is None


async def test_should_turn_an_escaped_exception_into_a_generic_500_problem(
    client: httpx.AsyncClient, log_stream: io.StringIO
) -> None:
    response = await client.get("/boom")

    assert response.status_code == 500
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    body = response.json()
    assert body["type"] == "internal_error"
    assert body["request_id"] == response.headers["x-request-id"]
    assert "SELECT" not in response.text
    assert "Traceback" not in response.text
    errors = [line for line in _lines(log_stream) if line["event"] == "unhandled_exception"]
    assert len(errors) == 1
    assert errors[0]["request_id"] == response.headers["x-request-id"]
    assert errors[0]["exception"]  # the traceback is in the log, structured


async def test_should_answer_503_when_a_dependency_is_unreachable(
    client: httpx.AsyncClient, metrics: Metrics
) -> None:
    response = await client.get("/db-down")

    assert response.status_code == 503
    assert response.json()["type"] == "dependency_unavailable"
    assert response.headers["retry-after"] == "5"
    assert metrics.dependency_failures._value.get() == 1


async def test_should_refuse_a_declared_body_over_the_limit(client: httpx.AsyncClient) -> None:
    response = await client.post("/echo", content=b"x" * (MAX_BODY + 1))
    assert response.status_code == 413
    assert response.json()["type"] == "payload_too_large"


async def test_should_refuse_a_chunked_body_over_the_limit(client: httpx.AsyncClient) -> None:
    async def chunks() -> AsyncIterator[bytes]:
        for _ in range(4):
            yield b"y" * 1_000

    response = await client.post("/echo", content=chunks())
    assert response.status_code == 413
    assert response.json()["type"] == "payload_too_large"


async def test_should_accept_a_body_within_the_limit(client: httpx.AsyncClient) -> None:
    response = await client.post("/echo", content=b"z" * MAX_BODY)
    assert response.json() == {"bytes": MAX_BODY}


async def test_should_label_metrics_with_the_full_route_template(
    client: httpx.AsyncClient, metrics: Metrics
) -> None:
    await client.get("/v1/items/1")
    await client.get("/v1/items/2")
    await client.get("/does-not-exist")
    rendered = metrics.render().decode()
    assert 'route="/v1/items/{item_id}",status="200"} 2.0' in rendered
    assert f'route="{UNMATCHED_ROUTE}",status="404"' in rendered
    assert "/v1/items/1" not in rendered


async def test_should_write_one_access_line_per_request_with_its_id(
    client: httpx.AsyncClient, log_stream: io.StringIO
) -> None:
    response = await client.get("/v1/items/3", headers={"X-Request-ID": "trace-me-0001"})
    access = [line for line in _lines(log_stream) if line["event"] == "http_request"]
    assert len(access) == 1
    assert access[0]["request_id"] == "trace-me-0001" == response.headers["x-request-id"]
    assert access[0]["route"] == "/v1/items/{item_id}"
    assert access[0]["status"] == 200


async def test_should_add_security_headers_to_every_response(client: httpx.AsyncClient) -> None:
    for response in (await client.get("/v1/items/1"), await client.get("/boom")):
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["content-security-policy"].startswith("default-src 'none'")
        assert response.headers["strict-transport-security"].startswith("max-age=")
