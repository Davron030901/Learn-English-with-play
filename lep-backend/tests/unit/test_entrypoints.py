"""The process entry points fail fast, and quietly, on bad configuration."""

from __future__ import annotations

import json
import os
import runpy
import secrets
from pathlib import Path

import pytest

from app.main import EX_CONFIG, create_app


def _clear_lep_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    for name in list(os.environ):
        if name.startswith("LEP_"):
            monkeypatch.delenv(name)
    monkeypatch.setenv("LEP_SECRETS_DIR", str(tmp_path / "no-secrets"))


def test_the_api_exits_78_with_a_json_error_naming_what_is_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _clear_lep_env(monkeypatch, tmp_path)
    secret = secrets.token_urlsafe(24)
    monkeypatch.setenv("LEP_JWT_SECRET", secret)

    with pytest.raises(SystemExit) as exited:
        create_app()

    assert exited.value.code == EX_CONFIG
    error = json.loads(capsys.readouterr().err)
    assert error["event"] == "config_invalid"
    assert "LEP_DB_HOST" in error["detail"]
    assert secret not in error["detail"]


def test_the_api_starts_from_a_complete_environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _clear_lep_env(monkeypatch, tmp_path)
    for name, value in {
        "LEP_ENV": "test",
        "LEP_DB_HOST": "db",
        "LEP_DB_NAME": "lep",
        "LEP_DB_USER": "lep_app",
        "LEP_DB_PASSWORD": secrets.token_urlsafe(18),
        "LEP_REDIS_HOST": "redis",
        "LEP_JWT_SECRET": secrets.token_urlsafe(48),
        "LEP_ARGON2_MEMORY_KIB": "8",
        "LEP_ARGON2_TIME_COST": "1",
    }.items():
        monkeypatch.setenv(name, value)
    assert create_app().title == "Learn English with Play API"


def test_the_worker_entry_point_exits_78_without_configuration(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _clear_lep_env(monkeypatch, tmp_path)
    with pytest.raises(SystemExit) as exited:
        runpy.run_module("app.workers.main", run_name="app.workers.main")
    assert exited.value.code == EX_CONFIG
    assert json.loads(capsys.readouterr().err)["event"] == "config_invalid"


def test_the_worker_entry_point_builds_the_celery_app(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _clear_lep_env(monkeypatch, tmp_path)
    for name, value in {
        "LEP_ENV": "test",
        "LEP_DB_HOST": "db",
        "LEP_DB_NAME": "lep",
        "LEP_DB_USER": "lep_app",
        "LEP_DB_PASSWORD": secrets.token_urlsafe(18),
        "LEP_REDIS_HOST": "redis",
    }.items():
        monkeypatch.setenv(name, value)
    module = runpy.run_module("app.workers.main", run_name="app.workers.main")
    assert module["celery_app"].main == "lep"
