"""Refresh-token rotation, reuse detection, sign-out and session lifetimes."""

from __future__ import annotations

import asyncio
from datetime import timedelta

import httpx
import pytest

from app.config import Settings
from tests.factories import OffsetClock
from tests.integration.api import login, logout, me, refresh, signed_up
from tests.integration.conftest import Database, settings_for, start_app

pytestmark = pytest.mark.integration


async def _session_row(database: Database, refresh_hash_of: str) -> tuple[object, object]:
    from app.security.tokens import hash_refresh_token

    connection = await database.connect()
    try:
        row = await connection.fetchrow(
            """
            SELECT s.revoked_at, s.revoked_reason
            FROM refresh_tokens t JOIN auth_sessions s ON s.id = t.session_id
            WHERE t.token_hash = $1
            """,
            hash_refresh_token(refresh_hash_of),
        )
    finally:
        await connection.close()
    assert row is not None
    return row["revoked_at"], row["revoked_reason"]


async def test_refresh_returns_a_new_pair_and_the_new_access_token_works(
    client: httpx.AsyncClient,
) -> None:
    account = await signed_up(client)
    response = await refresh(client, account.refresh_token)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    pair = response.json()
    assert pair["refresh_token"] != account.refresh_token
    assert pair["access_token"] != account.access_token
    assert (await me(client, pair["access_token"])).status_code == 200


async def test_a_chain_of_refreshes_keeps_working(client: httpx.AsyncClient) -> None:
    token = (await signed_up(client)).refresh_token
    for _ in range(5):
        response = await refresh(client, token)
        assert response.status_code == 200
        token = response.json()["refresh_token"]


async def test_reusing_a_rotated_refresh_token_ends_the_session_for_every_holder(
    client: httpx.AsyncClient, database: Database
) -> None:
    account = await signed_up(client)
    rotated = (await refresh(client, account.refresh_token)).json()

    replay = await refresh(client, account.refresh_token)  # e.g. a stolen copy

    assert replay.status_code == 401
    assert replay.json()["type"] == "session_revoked"
    # the legitimate holder's newer tokens are dead too
    assert (await refresh(client, rotated["refresh_token"])).json()["type"] == "session_revoked"
    assert (await me(client, rotated["access_token"])).status_code == 401
    assert (await me(client, account.access_token)).status_code == 401
    revoked_at, reason = await _session_row(database, account.refresh_token)
    assert revoked_at is not None
    assert reason == "refresh_token_reuse"


async def test_concurrent_refreshes_of_one_token_let_exactly_one_through(
    client: httpx.AsyncClient,
) -> None:
    account = await signed_up(client)
    first, second = await asyncio.gather(
        refresh(client, account.refresh_token), refresh(client, account.refresh_token)
    )
    assert sorted([first.status_code, second.status_code]) == [200, 401]
    # Strict reuse detection: the loser's replay revokes the session (see DECISIONS.md).
    winner = first if first.status_code == 200 else second
    assert (await me(client, winner.json()["access_token"])).status_code == 401


async def test_an_unknown_refresh_token_is_rejected(client: httpx.AsyncClient) -> None:
    response = await refresh(client, "lep_rt_" + "A" * 43)
    assert response.status_code == 401
    assert response.json()["type"] == "invalid_token"


async def test_logout_revokes_access_immediately_not_at_token_expiry(
    client: httpx.AsyncClient, database: Database
) -> None:
    account = await signed_up(client)
    assert (await me(client, account.access_token)).status_code == 200

    response = await logout(client, account.refresh_token)

    assert response.status_code == 204
    assert (await me(client, account.access_token)).status_code == 401
    assert (await refresh(client, account.refresh_token)).json()["type"] == "session_revoked"
    assert (await _session_row(database, account.refresh_token))[1] == "logout"


async def test_logout_is_idempotent_and_reveals_nothing(client: httpx.AsyncClient) -> None:
    account = await signed_up(client)
    assert (await logout(client, account.refresh_token)).status_code == 204
    assert (await logout(client, account.refresh_token)).status_code == 204
    assert (await logout(client, "lep_rt_" + "B" * 43)).status_code == 204


async def test_logout_ends_only_its_own_session(client: httpx.AsyncClient) -> None:
    account = await signed_up(client)
    phone = (await login(client, account.email, account.password)).json()
    laptop = (await login(client, account.email, account.password)).json()

    await logout(client, phone["refresh_token"])

    assert (await me(client, phone["access_token"])).status_code == 401
    assert (await me(client, laptop["access_token"])).status_code == 200
    assert (await me(client, account.access_token)).status_code == 200


async def test_an_expired_refresh_token_is_rejected(
    client: httpx.AsyncClient, clock: OffsetClock, settings: Settings
) -> None:
    account = await signed_up(client)
    clock.advance(timedelta(seconds=settings.refresh_token_ttl_s + 1))
    response = await refresh(client, account.refresh_token)
    assert response.status_code == 401
    assert response.json()["type"] == "invalid_token"


async def test_a_session_ends_at_its_absolute_lifetime_however_often_it_is_refreshed(
    database: Database,
) -> None:
    short = settings_for(database, refresh_token_ttl_s=3_600, session_max_age_s=3 * 3_600)
    clock = OffsetClock()
    async with start_app(short, clock=clock) as running:
        token = (await signed_up(running.client)).refresh_token
        for _ in range(5):  # 50-minute hops: each refresh is inside the 1 h refresh window
            clock.advance(timedelta(minutes=50))
            response = await refresh(running.client, token)
            if response.status_code != 200:
                break
            token = response.json()["refresh_token"]
            assert response.json()["refresh_expires_in"] <= 3 * 3_600
    assert response.status_code == 401  # 250 min > the 3 h session lifetime
    assert response.json()["type"] == "invalid_token"
