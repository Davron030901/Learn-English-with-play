from __future__ import annotations

import secrets
from typing import Any

from celery import Celery
from pydantic import SecretStr

from app.config import WorkerSettings
from app.workers.celery_app import create_celery, worker_settings


def _settings(**overrides: Any) -> WorkerSettings:
    values: dict[str, Any] = {
        "env": "test",
        "db_host": "127.0.0.1",
        "db_name": "lep_unit",
        "db_user": "lep_app",
        "db_password": SecretStr(secrets.token_urlsafe(18)),
        "redis_host": "127.0.0.1",
        "celery_task_time_limit_s": 300,
    }
    values.update(overrides)
    return WorkerSettings.model_validate(values)


def _app(**overrides: Any) -> Celery:
    return create_celery(_settings(**overrides))


def test_only_json_crosses_the_broker() -> None:
    conf = _app().conf
    assert conf.accept_content == ["json"]
    assert conf.task_serializer == "json"
    assert conf.result_serializer == "json"


def test_delivery_is_at_least_once_one_task_at_a_time() -> None:
    conf = _app().conf
    assert conf.task_acks_late is True
    assert conf.task_reject_on_worker_lost is True
    assert conf.worker_prefetch_multiplier == 1


def test_visibility_timeout_outlasts_the_longest_task() -> None:
    conf = _app(celery_task_time_limit_s=300).conf
    assert conf.broker_transport_options["visibility_timeout"] > conf.task_time_limit
    assert conf.task_soft_time_limit < conf.task_time_limit


def test_the_broker_uses_its_own_redis_database() -> None:
    app = _app(redis_db=0, celery_broker_db=1)
    assert app.conf.broker_url.endswith("/1")


def test_beat_schedules_the_auth_purge_and_the_task_exists() -> None:
    app = _app()
    entry = app.conf.beat_schedule["purge-expired-auth-sessions"]
    assert entry["task"] == "lep.auth.purge_expired_sessions"
    app.loader.import_default_modules()
    assert "lep.auth.purge_expired_sessions" in app.tasks
    assert "lep.ping" in app.tasks
    ai = app.conf.beat_schedule["purge-expired-ai-conversations"]
    assert ai["task"] == "lep.ai.purge_expired_conversations"
    assert "lep.ai.purge_expired_conversations" in app.tasks
    bias = app.conf.beat_schedule["rater-bias-audit"]
    assert bias["task"] == "lep.assessment.bias_audit"
    assert "lep.assessment.bias_audit" in app.tasks
    for name in ("purge-expired-recordings", "seed-media-assets", "tts-drafts"):
        assert app.conf.beat_schedule[name]["task"] in app.tasks
    # league weeks end on Sunday 20:00 in Tashkent (UTC+5): settled just after, at 15:02 UTC
    leagues = app.conf.beat_schedule["settle-league-weeks"]
    assert leagues["task"] == "lep.leagues.settle"
    assert "lep.leagues.settle" in app.tasks
    assert leagues["schedule"].day_of_week == {0}
    assert (leagues["schedule"].hour, leagues["schedule"].minute) == ({15}, {2})
    assert app.conf.result_expires is None  # no result backend, so nothing to clean up


def test_ping_task_answers() -> None:
    app = _app()
    app.loader.import_default_modules()
    assert app.tasks["lep.ping"].apply().get() == "pong"


def test_tasks_read_the_settings_the_app_was_created_with() -> None:
    settings = _settings(auth_session_retention_days=12)
    create_celery(settings)
    assert worker_settings() is settings
