from __future__ import annotations

import secrets
from pathlib import Path

import pytest
from pydantic import SecretStr, ValidationError

from app.config import (
    ConfigError,
    MigrationSettings,
    Settings,
    WorkerSettings,
    describe_validation_error,
    load_settings,
)
from tests.factories import make_settings


def _clear_lep_env(monkeypatch: pytest.MonkeyPatch) -> None:
    import os

    for name in list(os.environ):
        if name.startswith("LEP_"):
            monkeypatch.delenv(name)


def test_should_name_every_missing_variable_without_echoing_values(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _clear_lep_env(monkeypatch)
    monkeypatch.setenv("LEP_SECRETS_DIR", str(tmp_path / "absent"))
    secret_value = "hunter2-" + secrets.token_hex(8)
    monkeypatch.setenv("LEP_DB_PASSWORD", secret_value)

    with pytest.raises(ConfigError) as caught:
        load_settings(Settings)

    message = str(caught.value)
    for name in ("LEP_ENV", "LEP_DB_HOST", "LEP_DB_NAME", "LEP_DB_USER", "LEP_JWT_SECRET"):
        assert name in message
    assert "LEP_DB_PASSWORD" not in message  # it was provided
    assert secret_value not in message
    assert caught.value.__cause__ is None  # the pydantic error (with inputs) is not chained


def test_should_read_secrets_from_files_named_after_the_variable(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _clear_lep_env(monkeypatch)
    jwt = secrets.token_urlsafe(48)
    db_password = secrets.token_urlsafe(18)
    (tmp_path / "lep_jwt_secret").write_text(jwt + "\n")
    (tmp_path / "lep_db_password").write_text(db_password)
    monkeypatch.setenv("LEP_SECRETS_DIR", str(tmp_path))
    for name, value in {
        "LEP_ENV": "dev",
        "LEP_DB_HOST": "db",
        "LEP_DB_NAME": "lep",
        "LEP_DB_USER": "lep_app",
        "LEP_REDIS_HOST": "redis",
    }.items():
        monkeypatch.setenv(name, value)

    settings = load_settings(Settings)

    assert settings.jwt_secret.get_secret_value() == jwt  # trailing newline stripped
    assert settings.db_password.get_secret_value() == db_password
    assert jwt not in repr(settings)


def test_should_parse_comma_separated_lists_from_the_environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _clear_lep_env(monkeypatch)
    monkeypatch.setenv("LEP_SECRETS_DIR", str(tmp_path))
    for name, value in {
        "LEP_ENV": "dev",
        "LEP_DB_HOST": "db",
        "LEP_DB_NAME": "lep",
        "LEP_DB_USER": "lep_app",
        "LEP_DB_PASSWORD": secrets.token_urlsafe(18),
        "LEP_REDIS_HOST": "redis",
        "LEP_JWT_SECRET": secrets.token_urlsafe(48),
        "LEP_CORS_ORIGINS": "https://app.example.com, http://localhost:5173/",
        "LEP_SUPPORTED_L1": "uz,ru,uz,kk",
    }.items():
        monkeypatch.setenv(name, value)

    settings = load_settings(Settings)

    assert settings.cors_origins == ["https://app.example.com", "http://localhost:5173"]
    assert settings.supported_l1 == ["uz", "ru", "kk"]


@pytest.mark.parametrize(
    "origin", ["*", "app.example.com", "https://app.example.com/path", "ftp://x.example"]
)
def test_should_reject_cors_origins_that_are_not_explicit_origins(origin: str) -> None:
    with pytest.raises(ValidationError):
        make_settings(cors_origins=[origin])


def test_should_reject_a_short_jwt_secret() -> None:
    with pytest.raises(ValidationError) as caught:
        make_settings(jwt_secret=SecretStr("too-short"))
    assert "32 bytes" in describe_validation_error(caught.value)


def test_should_reject_a_previous_jwt_secret_equal_to_the_current_one() -> None:
    key = SecretStr(secrets.token_urlsafe(48))
    with pytest.raises(ValidationError):
        make_settings(jwt_secret=key, jwt_previous_secret=key)


def test_should_refuse_weak_argon2_parameters_outside_tests() -> None:
    with pytest.raises(ValidationError) as caught:
        make_settings(env="dev", argon2_memory_kib=1024)
    assert "OWASP" in describe_validation_error(caught.value)
    assert make_settings(env="dev", argon2_memory_kib=19_456, argon2_time_cost=2).env == "dev"


def test_should_require_encrypted_transport_and_a_redis_password_in_production() -> None:
    strong = {"argon2_memory_kib": 19_456, "argon2_time_cost": 2}
    with pytest.raises(ValidationError, match="LEP_DB_SSL_MODE"):
        make_settings(env="prod", db_ssl_mode="prefer", **strong)
    with pytest.raises(ValidationError, match="LEP_REDIS_PASSWORD"):
        make_settings(env="prod", db_ssl_mode="require", **strong)
    with pytest.raises(ValidationError, match="LEP_REDIS_PASSWORD"):
        make_settings(env="prod", db_ssl_mode="require", redis_password=SecretStr(""), **strong)
    redis_password = SecretStr(secrets.token_urlsafe(18))
    with pytest.raises(ValidationError, match="LEP_METRICS_TOKEN"):
        make_settings(env="prod", db_ssl_mode="require", redis_password=redis_password, **strong)
    prod = make_settings(
        env="prod",
        db_ssl_mode="verify-full",
        redis_password=redis_password,
        metrics_token=SecretStr(secrets.token_urlsafe(24)),
        **strong,
    )
    assert prod.openapi_enabled is False


def test_should_keep_the_celery_broker_in_its_own_redis_database() -> None:
    with pytest.raises(ValidationError, match="LEP_CELERY_BROKER_DB"):
        make_settings(redis_db=3, celery_broker_db=3)


def test_should_escape_the_redis_password_in_the_broker_url() -> None:
    settings = make_settings(redis_password=SecretStr("p@ss/word:1"), redis_port=6380)
    assert settings.celery_broker_url() == "redis://:p%40ss%2Fword%3A1@127.0.0.1:6380/1"
    tls = make_settings(redis_ssl=True)
    assert tls.celery_broker_url().startswith("rediss://")
    assert tls.celery_broker_url().endswith("?ssl_cert_reqs=required")


def test_should_mask_the_database_password_when_the_url_is_rendered() -> None:
    settings = make_settings()
    url = settings.sqlalchemy_url(settings.db_user, settings.db_password)
    assert settings.db_password.get_secret_value() not in str(url)


def test_worker_and_migration_settings_do_not_carry_the_jwt_key() -> None:
    assert "jwt_secret" not in WorkerSettings.model_fields
    assert "jwt_secret" not in MigrationSettings.model_fields
    assert "db_password" not in MigrationSettings.model_fields
