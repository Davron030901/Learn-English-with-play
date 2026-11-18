"""The demo learner (``make demo``): created through the API, idempotent, never in production."""

from __future__ import annotations

import pytest

from app.config import Settings
from scripts import seed_demo
from tests.integration.conftest import start_app

pytestmark = pytest.mark.integration

PASSWORD = "Demo-password-2026"


async def test_the_demo_learner_has_a_tested_out_unit_a_lesson_and_reviews_due(
    settings: Settings,
) -> None:
    first = await seed_demo.seed(settings, PASSWORD)
    assert first["created"] is True
    assert first["unit_tested_out"] is True
    assert first["lesson_played"] is True, first["lesson_note"]
    assert first["reviews_due_now"] > 0, "answers from two weeks ago are due today"

    again = await seed_demo.seed(settings, PASSWORD)
    assert again["created"] is False, "running it twice changes nothing"

    async with start_app(settings) as running:
        login = await running.client.post(
            "/v1/auth/login",
            data={"username": seed_demo.DEMO_EMAIL, "password": PASSWORD, "grant_type": "password"},
        )
        assert login.status_code == 200, login.text


def test_the_seed_refuses_production(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    monkeypatch.setattr(
        seed_demo, "load_settings", lambda _cls: settings.model_copy(update={"env": "prod"})
    )
    monkeypatch.setenv("LEP_DEMO_PASSWORD", PASSWORD)
    assert seed_demo.main(["seed_demo"]) == 2
