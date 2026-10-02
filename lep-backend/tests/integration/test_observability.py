"""Request ids on every log line, nothing secret in the logs, and route-labelled metrics."""

from __future__ import annotations

import io
import json
import logging
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from app.config import Settings
from app.observability.logs import configure_logging
from tests.integration.api import bearer, login, logout, me, refresh, register, signed_up

pytestmark = pytest.mark.integration


@pytest.fixture
def captured(app: FastAPI, settings: Settings) -> Iterator[io.StringIO]:
    """The server's log output as JSON lines (the test client's own logger is silenced)."""
    stream = io.StringIO()
    configure_logging(level="DEBUG", json=True, service="lep-test", stream=stream)
    quiet = [logging.getLogger(name) for name in ("httpx", "httpcore")]
    for logger in quiet:
        logger.setLevel(logging.WARNING)
    yield stream
    configure_logging(level=settings.log_level, json=True, service=settings.service_name)


def _lines(stream: io.StringIO) -> list[dict[str, Any]]:
    return [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]


async def test_every_log_line_emitted_during_a_request_carries_its_request_id(
    client: httpx.AsyncClient, captured: io.StringIO
) -> None:
    ids = [f"req-{name}-0001" for name in ("register", "login", "refresh", "logout", "me", "404")]
    body = {
        "email": "trace.me@example.com",
        "password": "correct horse battery staple",
        "l1": "ru",
        "birth_year": 1990,
        "tz": "Europe/Moscow",
    }
    registered = await client.post("/v1/auth/register", json=body, headers={"X-Request-ID": ids[0]})
    signed_in = await client.post(
        "/v1/auth/login",
        data={"username": body["email"], "password": body["password"]},
        headers={"X-Request-ID": ids[1]},
    )
    tokens = signed_in.json()
    rotated = await client.post(
        "/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
        headers={"X-Request-ID": ids[2]},
    )
    await client.post(
        "/v1/auth/logout",
        json={"refresh_token": rotated.json()["refresh_token"]},
        headers={"X-Request-ID": ids[3]},
    )
    await client.get("/v1/me", headers={**bearer(tokens["access_token"]), "X-Request-ID": ids[4]})
    await client.get("/v1/nowhere", headers={"X-Request-ID": ids[5]})

    lines = _lines(captured)
    assert registered.headers["x-request-id"] == ids[0]
    assert lines, "no log output captured"
    assert all(line.get("request_id") in ids for line in lines), [
        line for line in lines if line.get("request_id") not in ids
    ]
    # and each request produced its access line under its own id
    access = {line["request_id"] for line in lines if line["event"] == "http_request"}
    assert access == set(ids)


async def test_passwords_and_tokens_never_reach_the_logs(
    client: httpx.AsyncClient, captured: io.StringIO
) -> None:
    account = await signed_up(client)
    pair = (await login(client, account.email, account.password)).json()
    rotated = (await refresh(client, pair["refresh_token"])).json()
    await me(client, rotated["access_token"])
    await logout(client, rotated["refresh_token"])
    await register(client, password="Short-1")  # a rejected password

    output = captured.getvalue()
    for secret in (
        account.password,
        "Short-1",
        account.access_token,
        account.refresh_token,
        pair["access_token"],
        pair["refresh_token"],
        rotated["refresh_token"],
    ):
        assert secret not in output


async def test_metrics_are_labelled_by_the_full_route_template(client: httpx.AsyncClient) -> None:
    account = await signed_up(client)
    await me(client, account.access_token)
    text = (await client.get("/metrics")).text
    assert 'route="/v1/auth/register",status="201"' in text
    assert 'route="/v1/me",status="200"' in text
    assert 'auth_events_total{event="register"} 1.0' in text
