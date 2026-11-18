"""Real PostgreSQL 16 and Redis 7 for integration tests.

Two ways to get them, tried in this order:

1. ``LEP_TEST_PG_HOST`` (with ``LEP_TEST_PG_PORT``, ``LEP_TEST_PG_USER``,
   ``LEP_TEST_PG_PASSWORD``) and ``LEP_TEST_REDIS_HOST`` (with ``LEP_TEST_REDIS_PORT``,
   ``LEP_TEST_REDIS_PASSWORD``) name running services: CI service containers, or a
   machine where Docker cannot pull images. The PostgreSQL user must be a superuser.
2. Otherwise testcontainers starts ``postgres:16-alpine`` and ``redis:7-alpine``.

If neither is available the tests fail with instructions; they never skip silently.

Each session creates a throwaway database, migrates it to head as the superuser (the
schema owner), and creates a login role that is only a member of ``lep_app_rw`` — the
same privileges the API has in production. The app under test connects as that role.
Every test starts with empty tables and an empty Redis database.
"""

from __future__ import annotations

import asyncio
import os
import secrets
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import asyncpg
import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from pydantic import SecretStr
from redis.asyncio import Redis
from sqlalchemy.engine import URL

from app.config import Settings, WorkerSettings
from app.main import build_app
from tests.factories import OffsetClock, make_settings

ROOT = Path(__file__).resolve().parents[2]
REDIS_DB = 14
BROKER_DB = 15
APP_GROUP_ROLE = "lep_app_rw"
#: ``leagues`` has no learner column, so truncating learners does not reach it
TABLES = ("learners", "learner_settings", "auth_sessions", "refresh_tokens", "leagues")
#: High enough that no test trips a limit unless it sets its own.
NO_LIMIT = 100_000


@dataclass(frozen=True)
class Services:
    pg_host: str
    pg_port: int
    pg_user: str
    pg_password: str
    redis_host: str
    redis_port: int
    redis_password: str | None


@dataclass(frozen=True)
class Database:
    services: Services
    name: str
    app_user: str
    app_password: str

    def superuser_url(self) -> URL:
        s = self.services
        return URL.create(
            "postgresql+asyncpg",
            username=s.pg_user,
            password=s.pg_password,
            host=s.pg_host,
            port=s.pg_port,
            database=self.name,
        )

    async def connect(self, *, as_app: bool = False) -> asyncpg.Connection:
        s = self.services
        return await asyncpg.connect(
            host=s.pg_host,
            port=s.pg_port,
            user=self.app_user if as_app else s.pg_user,
            password=self.app_password if as_app else s.pg_password,
            database=self.name,
        )


def _services_from_env() -> Services | None:
    host = os.environ.get("LEP_TEST_PG_HOST")
    if not host:
        return None
    try:
        return Services(
            pg_host=host,
            pg_port=int(os.environ.get("LEP_TEST_PG_PORT", "5432")),
            pg_user=os.environ["LEP_TEST_PG_USER"],
            pg_password=os.environ["LEP_TEST_PG_PASSWORD"],
            redis_host=os.environ.get("LEP_TEST_REDIS_HOST", host),
            redis_port=int(os.environ.get("LEP_TEST_REDIS_PORT", "6379")),
            redis_password=os.environ.get("LEP_TEST_REDIS_PASSWORD") or None,
        )
    except KeyError as missing:
        pytest.fail(f"LEP_TEST_PG_HOST is set but {missing.args[0]} is not", pytrace=False)


def _containers() -> Iterator[Services]:
    try:
        import docker
        from testcontainers.community.postgres import PostgresContainer
        from testcontainers.community.redis import RedisContainer

        docker.from_env().ping()
    except Exception as exc:  # noqa: BLE001 - any failure here means "no usable Docker"
        pytest.fail(
            "Integration tests need PostgreSQL 16 and Redis 7: either Docker for "
            "testcontainers, or running services named by LEP_TEST_PG_HOST, "
            "LEP_TEST_PG_USER, LEP_TEST_PG_PASSWORD, LEP_TEST_REDIS_HOST and "
            f"LEP_TEST_REDIS_PASSWORD. Docker is unavailable ({type(exc).__name__}).",
            pytrace=False,
        )
    pg_password = secrets.token_urlsafe(18)
    redis_password = secrets.token_urlsafe(18)
    postgres = PostgresContainer(
        "postgres:16-alpine",
        username="lep_super",
        password=pg_password,
        dbname="postgres",
        driver=None,
    )
    redis = RedisContainer("redis:7-alpine", password=redis_password)
    with postgres, redis:
        yield Services(
            pg_host=postgres.get_container_host_ip(),
            pg_port=int(postgres.get_exposed_port(5432)),
            pg_user="lep_super",
            pg_password=pg_password,
            redis_host=redis.get_container_host_ip(),
            redis_port=int(redis.get_exposed_port(6379)),
            redis_password=redis_password,
        )


@pytest.fixture(scope="session")
def services() -> Iterator[Services]:
    from_env = _services_from_env()
    if from_env is not None:
        yield from_env
    else:
        yield from _containers()


async def admin(services: Services, database: str, *statements: str) -> None:
    connection = await asyncpg.connect(
        host=services.pg_host,
        port=services.pg_port,
        user=services.pg_user,
        password=services.pg_password,
        database=database,
    )
    try:
        for statement in statements:
            await connection.execute(statement)
    finally:
        await connection.close()


def alembic_config(url: URL) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.attributes["database_url"] = url
    config.attributes["configure_logger"] = False
    return config


def create_database(services: Services, *, migrate: bool = True) -> Database:
    suffix = secrets.token_hex(4)
    database = Database(
        services=services,
        name=f"lep_it_{suffix}",
        app_user=f"lep_it_app_{suffix}",
        app_password=secrets.token_urlsafe(18),
    )
    asyncio.run(admin(services, "postgres", f'CREATE DATABASE "{database.name}"'))
    if migrate:
        command.upgrade(alembic_config(database.superuser_url()), "head")
        asyncio.run(
            admin(
                services,
                database.name,
                f"CREATE ROLE \"{database.app_user}\" LOGIN PASSWORD '{database.app_password}' "
                f"IN ROLE {APP_GROUP_ROLE}",
            )
        )
    return database


def drop_database(database: Database) -> None:
    asyncio.run(
        admin(
            database.services,
            "postgres",
            f'DROP DATABASE IF EXISTS "{database.name}" WITH (FORCE)',
            f'DROP ROLE IF EXISTS "{database.app_user}"',
        )
    )


@pytest.fixture(scope="session")
def database(services: Services) -> Iterator[Database]:
    created = create_database(services)
    try:
        yield created
    finally:
        drop_database(created)


def _redis_password(services: Services) -> SecretStr | None:
    return SecretStr(services.redis_password) if services.redis_password else None


def settings_for(database: Database, **overrides: Any) -> Settings:
    s = database.services
    values: dict[str, Any] = {
        "db_host": s.pg_host,
        "db_port": s.pg_port,
        "db_name": database.name,
        "db_user": database.app_user,
        "db_password": SecretStr(database.app_password),
        "redis_host": s.redis_host,
        "redis_port": s.redis_port,
        "redis_password": _redis_password(s),
        "redis_db": REDIS_DB,
        "celery_broker_db": BROKER_DB,
        "rate_limit_ip_per_minute": NO_LIMIT,
        "rate_limit_account_per_minute": NO_LIMIT,
        "rate_limit_login_ip_per_minute": NO_LIMIT,
        "rate_limit_login_account_per_15min": NO_LIMIT,
        "rate_limit_register_ip_per_hour": NO_LIMIT,
        "rate_limit_refresh_per_minute": NO_LIMIT,
    }
    values.update(overrides)
    return make_settings(**values)


def worker_settings_for(database: Database, **overrides: Any) -> WorkerSettings:
    s = database.services
    values: dict[str, Any] = {
        "env": "test",
        "db_host": s.pg_host,
        "db_port": s.pg_port,
        "db_name": database.name,
        "db_user": database.app_user,
        "db_password": SecretStr(database.app_password),
        "db_ssl_mode": "disable",
        "redis_host": s.redis_host,
        "redis_port": s.redis_port,
        "redis_password": _redis_password(s),
        "redis_db": REDIS_DB,
        "celery_broker_db": BROKER_DB,
    }
    values.update(overrides)
    return WorkerSettings.model_validate(values)


@pytest.fixture
def settings(database: Database) -> Settings:
    return settings_for(database)


@pytest.fixture
def clock() -> OffsetClock:
    return OffsetClock()


class RunningApp:
    """An app with its lifespan entered, and a client for it."""

    def __init__(self, app: FastAPI, client: httpx.AsyncClient) -> None:
        self.app = app
        self.client = client


@asynccontextmanager
async def start_app(
    settings: Settings, *, clock: OffsetClock | None = None, client_ip: str = "127.0.0.1"
) -> AsyncIterator[RunningApp]:
    application = build_app(settings, clock=clock or OffsetClock())
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application, client=(client_ip, 50_000))
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield RunningApp(application, client)


@pytest.fixture
async def app(settings: Settings, clock: OffsetClock) -> AsyncIterator[FastAPI]:
    application = build_app(settings, clock=clock)
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 50_000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture(autouse=True)
async def _clean_state(database: Database) -> None:
    connection = await database.connect()
    try:
        # The review tables are append-only; test clean-up is an erasure, like account deletion.
        await connection.execute("SET lep.erasure = 'on'")
        await connection.execute(f"TRUNCATE {', '.join(TABLES)} CASCADE")
    finally:
        await connection.close()
    services = database.services
    redis = Redis(
        host=services.redis_host,
        port=services.redis_port,
        db=REDIS_DB,
        password=services.redis_password,
    )
    try:
        await redis.flushdb()
    finally:
        await redis.aclose()
