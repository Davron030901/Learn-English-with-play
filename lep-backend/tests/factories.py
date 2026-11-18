"""Test data builders shared by unit and integration tests."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from itertools import count
from typing import Any

from pydantic import SecretStr

from app.config import Settings

_sequence = count(1)

#: Long enough for the policy, and never the email address.
PASSWORD = "correct horse battery staple"


def make_settings(**overrides: Any) -> Settings:
    """Settings for tests, validated like production but without reading the environment."""
    values: dict[str, Any] = {
        "env": "test",
        "db_host": "127.0.0.1",
        "db_name": "lep_unit",
        "db_user": "lep_app",
        "db_password": SecretStr(secrets.token_urlsafe(18)),
        "db_ssl_mode": "disable",
        "redis_host": "127.0.0.1",
        "jwt_secret": SecretStr(secrets.token_urlsafe(48)),
        # Argon2 at test cost; production minimums are enforced for every other env.
        "argon2_time_cost": 1,
        "argon2_memory_kib": 8,
        "log_json": True,
    }
    values.update(overrides)
    return Settings.model_validate(values)


def registration(**overrides: Any) -> dict[str, Any]:
    """A valid POST /v1/auth/register body with a unique email."""
    body: dict[str, Any] = {
        "email": f"learner{next(_sequence)}.{secrets.token_hex(3)}@example.com",
        "password": PASSWORD,
        "l1": "uz",
        "birth_year": 2000,
        "tz": "Asia/Tashkent",
    }
    body.update(overrides)
    return body


class FrozenClock:
    """A clock that only moves when told to."""

    def __init__(self, now: datetime | None = None) -> None:
        self._now = now or datetime(2026, 9, 25, 9, 0, tzinfo=UTC)

    def now(self) -> datetime:
        return self._now

    def set(self, now: datetime) -> None:
        self._now = now


class OffsetClock:
    """Real time plus an adjustable offset.

    Access tokens are checked against the real clock by PyJWT, so integration tests run
    on real time and move this clock forward only to expire refresh tokens and sessions.
    """

    def __init__(self) -> None:
        self.offset = timedelta(0)

    def now(self) -> datetime:
        return datetime.now(UTC) + self.offset

    def advance(self, delta: timedelta) -> None:
        self.offset += delta
