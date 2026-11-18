"""GET /v1/capabilities and POST /v1/client-events."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from tests.factories import OffsetClock
from tests.integration.conftest import Database, settings_for, start_app

pytestmark = pytest.mark.integration


async def test_a_plain_server_offers_none_of_the_optional_features(
    client: httpx.AsyncClient,
) -> None:
    r = await client.get("/v1/capabilities")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=300"
    body = r.json()
    assert body.pop("content_version").startswith("sha256:")
    assert body == {
        "ai_partner": False,
        "tts": False,
        "speech_scoring": False,
        "password_reset": False,
        "web_refresh_cookie": False,
        "breached_password_check": "built_in",
    }


async def test_configured_features_are_reported(
    database: Database, clock: OffsetClock, tmp_path: Path
) -> None:
    settings = settings_for(
        database,
        mail_backend="file",
        mail_outbox_dir=tmp_path,
        mail_from="no-reply@example.org",
        password_reset_url="https://app.example.org/reset-password",
        web_refresh_cookie=True,
        hibp_enabled=True,
    )
    async with start_app(settings, clock=clock) as running:
        body = (await running.client.get("/v1/capabilities")).json()
    assert body["password_reset"] is True
    assert body["web_refresh_cookie"] is True
    assert body["breached_password_check"] == "built_in_and_hibp"


def _count(app: FastAPI, name: str, platform: str) -> float:
    counter = app.state.container.metrics.client_events.labels(name=name, platform=platform)
    value: float = counter._value.get()
    return value


async def test_client_events_are_counted_and_nothing_else_is_accepted(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    before = _count(app, "refresh_response_lost", "android")
    batch: dict[str, Any] = {
        "platform": "android",
        "app_version": "1.4.0+57",
        "events": [
            {"name": "refresh_response_lost"},
            {"name": "refresh_response_lost", "count": 2},
            {"name": "outbox_full"},
        ],
    }
    r = await client.post("/v1/client-events", json=batch)
    assert r.status_code == 202, r.text
    assert r.json() == {"accepted": 4}
    assert _count(app, "refresh_response_lost", "android") == before + 3

    for bad in (
        {**batch, "events": [{"name": "learner_email", "count": 1}]},
        {**batch, "events": [{"name": "outbox_full", "detail": "free text"}]},
        {**batch, "events": []},
        {**batch, "events": [{"name": "outbox_full"}] * 21},
        {**batch, "platform": "desktop"},
        {**batch, "app_version": "1.0 <script>"},
        {**batch, "learner_id": "x"},
    ):
        assert (await client.post("/v1/client-events", json=bad)).status_code == 422, bad
