"""Token-bucket limits in Redis: per IP, per account, and the fail-open/closed policy."""

from __future__ import annotations

import asyncio
import socket

import pytest
from pydantic import SecretStr

from app.observability.metrics import Metrics
from app.redis_client import close_redis, create_redis
from app.security.rate_limit import Limit, RateLimiter
from tests.integration.api import login, me, register, signed_up
from tests.integration.conftest import Database, settings_for, start_app

pytestmark = pytest.mark.integration


def _closed_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
    return port


async def test_login_is_limited_per_ip(database: Database) -> None:
    limited = settings_for(database, rate_limit_login_ip_per_minute=3)
    async with start_app(limited) as running:
        statuses = [
            (await login(running.client, f"u{i}@example.com", "wrong password")).status_code
            for i in range(4)
        ]
        blocked = await login(running.client, "u9@example.com", "wrong password")
    assert statuses == [401, 401, 401, 429]
    assert blocked.json()["type"] == "rate_limited"
    assert 1 <= int(blocked.headers["retry-after"]) <= 60


async def test_login_is_limited_per_account_whatever_the_ip(database: Database) -> None:
    limited = settings_for(database, rate_limit_login_account_per_15min=2)
    async with start_app(limited) as setup:
        account = await signed_up(setup.client)
    statuses = []
    for ip in ("198.51.100.1", "198.51.100.2", "198.51.100.3"):
        async with start_app(limited, client_ip=ip) as running:
            statuses.append(
                (await login(running.client, account.email, "wrong password")).status_code
            )
    assert statuses == [401, 401, 429]


async def test_registration_is_limited_per_ip(database: Database) -> None:
    limited = settings_for(database, rate_limit_register_ip_per_hour=2)
    async with start_app(limited) as running:
        statuses = [(await register(running.client)).status_code for _ in range(3)]
    assert statuses == [201, 201, 429]


async def test_all_api_traffic_is_limited_per_ip(database: Database) -> None:
    limited = settings_for(database, rate_limit_ip_per_minute=2)
    async with start_app(limited) as running:
        statuses = [(await running.client.get("/v1/me")).status_code for _ in range(3)]
        health = await running.client.get("/health")
    assert statuses == [401, 401, 429]
    assert health.status_code == 200  # probes are outside /v1 and never limited


async def test_authenticated_traffic_is_limited_per_account(database: Database) -> None:
    limited = settings_for(database, rate_limit_account_per_minute=2)
    async with start_app(limited) as running:
        account = await signed_up(running.client)
        statuses = [(await me(running.client, account.access_token)).status_code for _ in range(3)]
    assert statuses == [200, 200, 429]


async def test_sign_in_fails_closed_but_other_traffic_fails_open_without_redis(
    database: Database,
) -> None:
    no_redis = settings_for(
        database, redis_port=_closed_port(), redis_password=SecretStr("irrelevant-password")
    )
    async with start_app(no_redis) as running:
        sign_in = await login(running.client, "someone@example.com", "some password")
        anonymous = await running.client.get("/v1/me")
    assert sign_in.status_code == 503
    assert sign_in.json()["type"] == "dependency_unavailable"
    assert anonymous.status_code == 401  # passed the IP limiter, then failed authentication


async def test_a_bucket_refills_over_time(database: Database) -> None:
    settings = settings_for(database)
    redis = create_redis(settings, client_name="lep-test")
    try:
        limiter = RateLimiter(redis, Metrics())
        limit = Limit("refill_test", capacity=2, window_s=1)  # one token every 500 ms
        first, second, third = [await limiter.hit(limit, "10.0.0.1") for _ in range(3)]
        assert (first.allowed, second.allowed, third.allowed) == (True, True, False)
        assert third.retry_after_s == 1
        await asyncio.sleep(0.6)
        assert (await limiter.hit(limit, "10.0.0.1")).allowed
        assert (await limiter.hit(limit, "10.0.0.2")).allowed  # buckets are per identity
    finally:
        await close_redis(redis)


async def test_identities_are_hashed_before_they_become_keys(database: Database) -> None:
    settings = settings_for(database)
    redis = create_redis(settings, client_name="lep-test")
    try:
        limiter = RateLimiter(redis, Metrics())
        await limiter.hit(Limit("login_account", 10, 900), "someone@example.com")
        keys = [key.decode() for key in await redis.keys("lep:rl:*")]
    finally:
        await close_redis(redis)
    assert len(keys) == 1
    assert "someone" not in keys[0]
    assert "example.com" not in keys[0]
