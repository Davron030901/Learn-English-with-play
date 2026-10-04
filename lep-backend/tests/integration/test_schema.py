"""The migrations: parity with the models, a clean round trip, least privilege, constraints."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import asyncpg
import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.models import Base
from app.models.partitions import include_name
from tests.integration.conftest import (
    TABLES,
    Database,
    Services,
    alembic_config,
    create_database,
    drop_database,
)

pytestmark = pytest.mark.integration


def _diff(connection: Connection) -> list[Any]:
    context = MigrationContext.configure(
        connection, opts={"compare_type": True, "include_name": include_name}
    )
    return list(compare_metadata(context, Base.metadata))


def test_migrations_produce_exactly_the_schema_the_models_describe(database: Database) -> None:
    async def run() -> list[Any]:
        engine = create_async_engine(database.superuser_url(), poolclass=NullPool)
        try:
            async with engine.connect() as connection:
                return await connection.run_sync(_diff)
        finally:
            await engine.dispose()

    assert asyncio.run(run()) == []


def test_downgrade_to_base_and_upgrade_again(services: Services) -> None:
    scratch = create_database(services, migrate=False)
    try:
        config = alembic_config(scratch.superuser_url())
        command.upgrade(config, "head")
        command.downgrade(config, "base")

        async def remaining() -> list[str]:
            connection = await scratch.connect()
            try:
                rows = await connection.fetch(
                    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
                )
                return sorted(row["tablename"] for row in rows)
            finally:
                await connection.close()

        assert asyncio.run(remaining()) == ["alembic_version"]
        command.upgrade(config, "head")
        assert set(TABLES) <= set(asyncio.run(remaining()))
    finally:
        drop_database(scratch)


async def _learner_values(email: str) -> tuple[Any, ...]:
    return (uuid.uuid4(), email, "$argon2id$placeholder", "uz", 2000, "Asia/Tashkent")


_INSERT_LEARNER = (
    "INSERT INTO learners (id, email, password_hash, l1, birth_year, tz) "
    "VALUES ($1, $2, $3, $4, $5, $6)"
)


async def test_the_api_role_can_write_rows_but_cannot_change_the_schema(
    database: Database,
) -> None:
    connection = await database.connect(as_app=True)
    try:
        await connection.execute(_INSERT_LEARNER, *await _learner_values("app.role@example.com"))
        assert await connection.fetchval("SELECT count(*) FROM learners") == 1
        for statement in (
            "CREATE TABLE sneaky (id int)",
            "DROP TABLE learners",
            "ALTER TABLE learners ADD COLUMN is_admin boolean",
            "TRUNCATE learners CASCADE",
        ):
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await connection.execute(statement)
    finally:
        await connection.close()


@pytest.mark.parametrize(
    ("statement", "params"),
    [
        ("UPDATE learners SET daily_goal_min = 7", ()),
        ("UPDATE learners SET l1 = 'Uzbek'", ()),
        ("UPDATE learners SET status = 'banned'", ()),
        ("UPDATE learner_settings SET desired_retention = 0.80", ()),
        ("UPDATE learner_settings SET rest_days = '{1,2,3}'", ()),
        ("UPDATE learner_settings SET rest_days = '{0}'", ()),
        ("UPDATE learner_settings SET spelling_variant = 'au'", ()),
    ],
)
async def test_check_constraints_back_up_the_api_validation(
    database: Database, statement: str, params: tuple[Any, ...]
) -> None:
    connection = await database.connect()
    try:
        values = await _learner_values("constraints@example.com")
        await connection.execute(_INSERT_LEARNER, *values)
        await connection.execute("INSERT INTO learner_settings (learner_id) VALUES ($1)", values[0])
        with pytest.raises(asyncpg.CheckViolationError):
            await connection.execute(statement, *params)
    finally:
        await connection.close()


async def test_emails_are_unique_regardless_of_case(database: Database) -> None:
    connection = await database.connect()
    try:
        await connection.execute(_INSERT_LEARNER, *await _learner_values("Case@Example.com"))
        with pytest.raises(asyncpg.UniqueViolationError):
            await connection.execute(_INSERT_LEARNER, *await _learner_values("case@example.COM"))
    finally:
        await connection.close()


async def test_updated_at_is_maintained_by_the_database(database: Database) -> None:
    connection = await database.connect()
    try:
        values = await _learner_values("touch@example.com")
        await connection.execute(_INSERT_LEARNER, *values)
        before = await connection.fetchval(
            "SELECT updated_at FROM learners WHERE id = $1", values[0]
        )
        await asyncio.sleep(0.01)
        await connection.execute("UPDATE learners SET daily_goal_min = 20 WHERE id = $1", values[0])
        after = await connection.fetchval(
            "SELECT updated_at FROM learners WHERE id = $1", values[0]
        )
    finally:
        await connection.close()
    assert after > before


async def test_deleting_a_learner_removes_their_sessions_and_tokens(database: Database) -> None:
    connection = await database.connect()
    try:
        values = await _learner_values("cascade@example.com")
        await connection.execute(_INSERT_LEARNER, *values)
        session_id = uuid.uuid4()
        await connection.execute(
            "INSERT INTO auth_sessions (id, learner_id, created_at, last_used_at, expires_at) "
            "VALUES ($1, $2, now(), now(), now() + interval '1 day')",
            session_id,
            values[0],
        )
        await connection.execute(
            "INSERT INTO refresh_tokens (id, session_id, token_hash, created_at, expires_at) "
            "VALUES ($1, $2, $3, now(), now() + interval '1 day')",
            uuid.uuid4(),
            session_id,
            b"\x00" * 32,
        )
        await connection.execute("DELETE FROM learners WHERE id = $1", values[0])
        assert await connection.fetchval("SELECT count(*) FROM auth_sessions") == 0
        assert await connection.fetchval("SELECT count(*) FROM refresh_tokens") == 0
    finally:
        await connection.close()
