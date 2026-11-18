"""Alembic environment (async, asyncpg).

Connects as the schema owner from ``MigrationSettings``. Tests pass a URL through
``config.attributes["database_url"]`` instead. Every migration runs in its own
transaction with a 5-second ``lock_timeout``: a migration that cannot get its lock
fails fast instead of queueing behind live traffic and blocking everything behind it.
"""

from __future__ import annotations

import asyncio
import json
import sys
from logging.config import fileConfig
from typing import Any

from alembic import context
from sqlalchemy.engine import URL, Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.config import ConfigError, MigrationSettings, load_settings
from app.db import connect_args
from app.models import Base
from app.models.partitions import include_name

config = context.config
target_metadata = Base.metadata

LOCK_TIMEOUT_MS = 5_000

if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name)


def _connection() -> tuple[URL | str, dict[str, Any]]:
    override = config.attributes.get("database_url")
    if override is not None:
        return override, {"server_settings": {"lock_timeout": str(LOCK_TIMEOUT_MS)}}
    try:
        settings = load_settings(MigrationSettings)
    except ConfigError as exc:
        sys.stderr.write(
            json.dumps({"level": "critical", "event": "config_invalid", "detail": str(exc)}) + "\n"
        )
        raise SystemExit(78) from None
    args = connect_args(settings, application_name=f"{settings.service_name}-migrations")
    # DDL can legitimately run long (an index build); only waiting for a lock is capped.
    args["server_settings"] = {
        **args["server_settings"],
        "statement_timeout": "0",
        "lock_timeout": str(LOCK_TIMEOUT_MS),
    }
    return settings.sqlalchemy_url(settings.db_migrator_user, settings.db_migrator_password), args


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of executing it (``alembic upgrade head --sql``)."""
    context.configure(
        url="postgresql+asyncpg://",
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_name=include_name,
    )
    with context.begin_transaction():
        context.run_migrations()


def _run(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        include_name=include_name,
        transaction_per_migration=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async() -> None:
    url, args = _connection()
    engine = create_async_engine(url, poolclass=NullPool, connect_args=args, hide_parameters=True)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_run)
    finally:
        await engine.dispose()


def run_migrations_online() -> None:
    asyncio.run(_run_async())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
