"""Async SQLAlchemy engine and session factory (asyncpg driver).

Every connection is bounded in time on both sides: asyncpg's connect timeout and
``command_timeout`` on the client, and ``statement_timeout`` plus
``idle_in_transaction_session_timeout`` on the server, so neither a slow query nor a
forgotten transaction can hold a pooled connection indefinitely.
"""

from __future__ import annotations

from typing import Any

from pydantic import SecretStr
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.config import DatabaseSettings

IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000


def connect_args(settings: DatabaseSettings, *, application_name: str) -> dict[str, Any]:
    return {
        "timeout": settings.db_connect_timeout_s,
        # client-side backstop, a little longer than the server-side statement timeout
        "command_timeout": settings.db_statement_timeout_ms / 1000 + 5,
        "ssl": settings.db_ssl_mode,
        "server_settings": {
            "application_name": application_name,
            "statement_timeout": str(settings.db_statement_timeout_ms),
            "idle_in_transaction_session_timeout": str(IDLE_IN_TRANSACTION_TIMEOUT_MS),
            "TimeZone": "UTC",
        },
    }


def create_engine(
    settings: DatabaseSettings,
    *,
    user: str,
    password: SecretStr,
    application_name: str,
    pooled: bool = True,
) -> AsyncEngine:
    url = settings.sqlalchemy_url(user, password)
    args = connect_args(settings, application_name=application_name)
    if not pooled:
        # short-lived processes (Celery tasks, scripts) open and close their own
        return create_async_engine(url, poolclass=NullPool, connect_args=args, hide_parameters=True)
    return create_async_engine(
        url,
        # bound values (emails, password hashes) must never reach an error message or a log
        hide_parameters=True,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_s,
        pool_pre_ping=True,
        pool_recycle=1_800,
        pool_use_lifo=True,
        connect_args=args,
    )


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
