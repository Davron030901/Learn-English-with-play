"""Redis client for rate limits, locks and caches (not the Celery broker).

A blocking pool with a hard ceiling: when every connection is busy, a caller waits at
most ``LEP_REDIS_SOCKET_TIMEOUT_S`` (rounded up to a whole second) instead of opening
connections without limit. One fast retry covers a dropped connection; anything longer
is an outage, and the caller's fail-open or fail-closed policy decides what happens.
"""

from __future__ import annotations

import math

from redis.asyncio import BlockingConnectionPool, Redis
from redis.asyncio.connection import Connection, SSLConnection
from redis.asyncio.retry import Retry
from redis.backoff import ExponentialWithJitterBackoff

from app.config import RedisSettings


def create_redis(settings: RedisSettings, *, client_name: str) -> Redis:
    password = settings.redis_password.get_secret_value() if settings.redis_password else None
    pool = BlockingConnectionPool(
        connection_class=SSLConnection if settings.redis_ssl else Connection,
        max_connections=settings.redis_max_connections,
        # how long to wait for a free connection (whole seconds in redis-py's API)
        timeout=math.ceil(settings.redis_socket_timeout_s),
        host=settings.redis_host,
        port=settings.redis_port,
        db=settings.redis_db,
        password=password,
        socket_timeout=settings.redis_socket_timeout_s,
        socket_connect_timeout=settings.redis_connect_timeout_s,
        retry=Retry(ExponentialWithJitterBackoff(base=0.02, cap=0.1), retries=1),
        health_check_interval=30,
        client_name=client_name,
    )
    return Redis(connection_pool=pool)


async def close_redis(client: Redis) -> None:
    await client.aclose()
    await client.connection_pool.disconnect()
