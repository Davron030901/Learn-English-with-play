"""The housekeeping task against the real database."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.workers.tasks import purge_expired_auth_sessions_async
from tests.integration.conftest import Database, worker_settings_for

pytestmark = pytest.mark.integration

NOW = datetime(2026, 9, 25, 3, 17, tzinfo=UTC)


async def _seed(database: Database) -> dict[str, uuid.UUID]:
    """One learner with sessions in every state, relative to NOW and 30 days' retention."""
    connection = await database.connect()
    learner = uuid.uuid4()
    sessions = {
        "active": uuid.uuid4(),
        "expired_recently": uuid.uuid4(),
        "expired_long_ago": uuid.uuid4(),
        "revoked_long_ago": uuid.uuid4(),
    }
    windows = {
        "active": (NOW - timedelta(days=5), NOW + timedelta(days=60), None),
        "expired_recently": (NOW - timedelta(days=100), NOW - timedelta(days=10), None),
        "expired_long_ago": (NOW - timedelta(days=200), NOW - timedelta(days=40), None),
        "revoked_long_ago": (
            NOW - timedelta(days=60),
            NOW + timedelta(days=30),
            NOW - timedelta(days=45),
        ),
    }
    try:
        await connection.execute(
            "INSERT INTO learners (id, email, password_hash, l1, birth_year, tz) "
            "VALUES ($1, 'purge@example.com', '$argon2id$x', 'uz', 2000, 'UTC')",
            learner,
        )
        for name, session_id in sessions.items():
            created, expires, revoked = windows[name]
            await connection.execute(
                "INSERT INTO auth_sessions "
                "(id, learner_id, created_at, last_used_at, expires_at, revoked_at, revoked_reason) "
                "VALUES ($1, $2, $3, $3, $4, $5, $6)",
                session_id,
                learner,
                created,
                expires,
                revoked,
                "logout" if revoked else None,
            )
        # an active session's old, long-expired refresh token is also purged
        await connection.execute(
            "INSERT INTO refresh_tokens (id, session_id, token_hash, created_at, expires_at, used_at) "
            "VALUES ($1, $2, $3, $4, $5, $5)",
            uuid.uuid4(),
            sessions["active"],
            b"\x01" * 32,
            NOW - timedelta(days=80),
            NOW - timedelta(days=35),
        )
        await connection.execute(
            "INSERT INTO refresh_tokens (id, session_id, token_hash, created_at, expires_at) "
            "VALUES ($1, $2, $3, $4, $5)",
            uuid.uuid4(),
            sessions["active"],
            b"\x02" * 32,
            NOW - timedelta(days=1),
            NOW + timedelta(days=29),
        )
    finally:
        await connection.close()
    return sessions


async def test_purge_removes_only_what_ended_before_the_retention_window(
    database: Database,
) -> None:
    sessions = await _seed(database)
    settings = worker_settings_for(database, auth_session_retention_days=30)

    result = await purge_expired_auth_sessions_async(settings, now=NOW)

    assert (result.sessions, result.refresh_tokens) == (2, 1)
    connection = await database.connect()
    try:
        remaining = {row["id"] for row in await connection.fetch("SELECT id FROM auth_sessions")}
        tokens = await connection.fetchval("SELECT count(*) FROM refresh_tokens")
    finally:
        await connection.close()
    assert remaining == {sessions["active"], sessions["expired_recently"]}
    assert tokens == 1


async def test_purge_is_idempotent(database: Database) -> None:
    await _seed(database)
    settings = worker_settings_for(database, auth_session_retention_days=30)
    await purge_expired_auth_sessions_async(settings, now=NOW)
    again = await purge_expired_auth_sessions_async(settings, now=NOW)
    assert (again.sessions, again.refresh_tokens) == (0, 0)
