"""The HTTP contract on the real application: problems, limits, headers, CORS, docs."""

from __future__ import annotations

import httpx
import pytest

from app.config import Settings
from tests.factories import registration
from tests.integration.conftest import Database, settings_for, start_app

pytestmark = pytest.mark.integration


async def test_unknown_routes_are_problem_documents_with_a_request_id(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/v1/nowhere")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["request_id"] == response.headers["x-request-id"]


async def test_an_oversized_body_is_refused_before_it_is_parsed(database: Database) -> None:
    small = settings_for(database, max_body_bytes=1_024)
    body = registration(password="x" * 2_000)
    async with start_app(small) as running:
        response = await running.client.post("/v1/auth/register", json=body)
    assert response.status_code == 413
    assert response.json()["type"] == "payload_too_large"


async def test_api_responses_carry_security_headers(client: httpx.AsyncClient) -> None:
    response = await client.get("/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert (
        response.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"
    )
    assert "strict-transport-security" not in response.headers  # production only


async def test_cors_allows_only_the_configured_origins(database: Database) -> None:
    with_cors = settings_for(database, cors_origins=["https://app.example.com"])
    preflight = {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }
    async with start_app(with_cors) as running:
        allowed = await running.client.options(
            "/v1/auth/login", headers={"Origin": "https://app.example.com", **preflight}
        )
        refused = await running.client.options(
            "/v1/auth/login", headers={"Origin": "https://evil.example.net", **preflight}
        )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "https://app.example.com"
    assert "access-control-allow-credentials" not in allowed.headers
    assert refused.status_code == 400
    assert "access-control-allow-origin" not in refused.headers


async def test_interactive_docs_are_off_when_disabled(settings: Settings) -> None:
    hidden = settings.model_copy(update={"docs_enabled": False})
    async with start_app(hidden) as running:
        assert (await running.client.get("/docs")).status_code == 404
        assert (await running.client.get("/openapi.json")).status_code == 404
