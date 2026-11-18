"""The review pipeline, end to end (backend brief Phase 4 and the sync half of Phase 9)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg
import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import DEFAULT_CONTENT_DIR
from app.content.catalog import ContentCatalog, ItemRecord, load_catalog_cached
from app.services.replay import replay_learner
from tests.integration.api import Account, bearer, signed_up
from tests.integration.conftest import Database

pytestmark = pytest.mark.integration

# well in the past: answers more than 5 minutes ahead of the server clock are re-timed
T0 = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)


@pytest.fixture(scope="module")
def catalog() -> ContentCatalog:
    return load_catalog_cached(DEFAULT_CONTENT_DIR)


@pytest.fixture
async def session(database: Database) -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(database.superuser_url(), poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as s:
            yield s
    finally:
        await engine.dispose()


def mcq(catalog: ContentCatalog, n: int = 0) -> ItemRecord:
    items = [i for i in catalog.items.values() if i.type_id == "mcq_word_from_definition"]
    return items[n]


def record(
    item: ItemRecord,
    *,
    correct: bool,
    at: datetime,
    client_uuid: uuid.UUID | None = None,
    local_verdict: str | None = None,
) -> dict[str, Any]:
    index = int(item.answer["index"])
    options = item.prompt["options"]
    chosen = index if correct else (index + 1) % len(options)
    return {
        "kind": "review",
        "client_uuid": str(client_uuid or uuid.uuid4()),
        "created_at": at.isoformat(),
        "monotonic_ms": 0,
        "payload": {
            "item_id": item.id,
            "session_id": str(uuid.uuid4()),
            "submission": {"kind": "choice", "index": chosen},
            "rt_ms": 4000,
            "hints_used": 0,
            "plays_used": 0,
            "content_version": "sha256:test",
            "local_verdict": local_verdict or ("correct" if correct else "incorrect"),
            "local_typo": False,
        },
    }


async def sync(
    client: httpx.AsyncClient, account: Account, records: list[dict[str, Any]]
) -> httpx.Response:
    return await client.post(
        "/v1/sync/reviews", json={"records": records}, headers=bearer(account.access_token)
    )


async def rows(database: Database, sql: str, *args: Any) -> list[asyncpg.Record]:
    connection = await database.connect()
    try:
        return list(await connection.fetch(sql, *args))
    finally:
        await connection.close()


async def test_answers_are_graded_on_the_server_and_scheduled(
    client: httpx.AsyncClient, database: Database, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    item = mcq(catalog)
    response = await sync(
        client,
        account,
        [
            record(item, correct=True, at=T0),
            # the device said correct; the server grades it and disagrees
            record(
                mcq(catalog, 1),
                correct=False,
                at=T0 + timedelta(seconds=30),
                local_verdict="correct",
            ),
        ],
    )
    assert response.status_code == 200, response.text
    results = response.json()["results"]
    assert [r["status"] for r in results] == ["accepted", "accepted"]
    assert [r["verdict"] for r in results] == ["correct", "incorrect"]
    assert results[1]["grade"] == 1
    state = await rows(
        database,
        "SELECT memory_item_id, reps, stability, due FROM memory_state WHERE learner_id = $1",
        uuid.UUID(account.learner_id),
    )
    assert {r["memory_item_id"] for r in state} == {
        *mcq(catalog).memory_items,
        *mcq(catalog, 1).memory_items,
    }
    assert all(r["reps"] == 1 and r["due"] > T0 for r in state)


async def test_a_client_uuid_is_ingested_once(
    client: httpx.AsyncClient, database: Database, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    same = uuid.uuid4()
    first = await sync(
        client, account, [record(mcq(catalog), correct=True, at=T0, client_uuid=same)]
    )
    again = await sync(
        client, account, [record(mcq(catalog), correct=False, at=T0, client_uuid=same)]
    )
    assert first.json()["results"][0]["status"] == "accepted"
    replay = again.json()["results"][0]
    assert replay["status"] == "duplicate"
    assert replay["verdict"] == "correct"  # the first verdict, not a re-grade
    attempts = await rows(
        database,
        "SELECT count(*) AS n FROM review_attempts WHERE learner_id = $1",
        uuid.UUID(account.learner_id),
    )
    assert attempts[0]["n"] == 1


async def test_one_bad_record_does_not_sink_the_batch(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    good = record(mcq(catalog), correct=True, at=T0)
    unknown = record(mcq(catalog), correct=True, at=T0)
    unknown["payload"]["item_id"] = "item.9999999"
    malformed = record(mcq(catalog), correct=True, at=T0)
    malformed["payload"]["submission"] = {"kind": "text", "text": "a choice item given text"}
    results = (await sync(client, account, [good, unknown, malformed])).json()["results"]
    assert [(r["status"], r["problem"]) for r in results] == [
        ("accepted", None),
        ("rejected", "unknown_item"),
        ("rejected", "invalid_submission"),
    ]


async def test_the_review_log_is_append_only_in_the_database(
    client: httpx.AsyncClient, database: Database, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    await sync(client, account, [record(mcq(catalog), correct=True, at=T0)])
    connection = await database.connect()
    try:
        for statement in ("UPDATE review_log SET grade = 4", "DELETE FROM review_log"):
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await connection.execute(statement)
    finally:
        await connection.close()
    as_app = await database.connect(as_app=True)
    try:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await as_app.execute("UPDATE review_attempts SET verdict = 'correct'")
    finally:
        await as_app.close()


async def test_replaying_the_log_reproduces_the_stored_state_exactly(
    client: httpx.AsyncClient, session: AsyncSession, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    items = [mcq(catalog, i) for i in range(5)]
    history = [
        record(items[i % 5], correct=(i % 3 != 0), at=T0 + timedelta(hours=7 * i))
        for i in range(25)
    ]
    for start in range(0, 25, 7):
        assert (await sync(client, account, history[start : start + 7])).status_code == 200
    async with session.begin():
        report = await replay_learner(session, uuid.UUID(account.learner_id))
    assert report.items >= 5
    assert report.drift == []
    assert report.missing == []


async def test_a_late_offline_batch_reorders_into_the_true_history(
    client: httpx.AsyncClient, session: AsyncSession, database: Database, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    item = mcq(catalog)
    # device B syncs a later answer first; device A's earlier answers arrive afterwards
    await sync(client, account, [record(item, correct=True, at=T0 + timedelta(days=3))])
    await sync(
        client,
        account,
        [
            record(item, correct=False, at=T0),
            record(item, correct=True, at=T0 + timedelta(days=1)),
        ],
    )
    state = await rows(
        database,
        "SELECT reps, lapses, last_review FROM memory_state WHERE learner_id = $1",
        uuid.UUID(account.learner_id),
    )
    assert state[0]["reps"] == 3
    assert state[0]["lapses"] == 1
    assert state[0]["last_review"] == T0 + timedelta(days=3)
    async with session.begin():
        report = await replay_learner(session, uuid.UUID(account.learner_id))
    assert report.drift == []


async def test_a_500_answer_offline_batch_replays_with_true_timestamps(
    client: httpx.AsyncClient, session: AsyncSession, database: Database, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    items = [mcq(catalog, i) for i in range(40)]
    batch = [
        record(items[i % 40], correct=(i % 4 != 0), at=T0 + timedelta(minutes=37 * i))
        for i in range(500)
    ]
    response = await sync(client, account, batch)
    assert response.status_code == 200, response.text
    assert all(r["status"] == "accepted" for r in response.json()["results"])
    stamps = await rows(
        database,
        "SELECT min(ts) AS first, max(ts) AS last, count(*) AS n FROM review_attempts "
        "WHERE learner_id = $1",
        uuid.UUID(account.learner_id),
    )
    assert stamps[0]["n"] == 500
    assert stamps[0]["first"] == T0
    assert stamps[0]["last"] == T0 + timedelta(minutes=37 * 499)
    async with session.begin():
        report = await replay_learner(session, uuid.UUID(account.learner_id))
    assert report.drift == []


async def test_a_clock_far_in_the_future_is_retimed_to_the_server(
    client: httpx.AsyncClient, database: Database, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    future = datetime.now(UTC) + timedelta(days=30)
    await sync(client, account, [record(mcq(catalog), correct=True, at=future)])
    row = await rows(
        database,
        "SELECT ts, clock_adjusted FROM review_attempts WHERE learner_id = $1",
        uuid.UUID(account.learner_id),
    )
    assert row[0]["clock_adjusted"] is True
    assert row[0]["ts"] < future


async def test_disputes_are_stored_for_review_and_never_regrade(
    client: httpx.AsyncClient, database: Database, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    answer = record(mcq(catalog), correct=False, at=T0)
    dispute = {
        "kind": "dispute",
        "client_uuid": str(uuid.uuid4()),
        "created_at": (T0 + timedelta(seconds=5)).isoformat(),
        "monotonic_ms": 5000,
        "payload": {"review_client_uuid": answer["client_uuid"], "item_id": mcq(catalog).id},
    }
    results = (await sync(client, account, [answer, dispute, dispute])).json()["results"]
    assert [r["status"] for r in results[:2]] == ["accepted", "accepted"]
    disputes = await rows(
        database,
        "SELECT status FROM answer_disputes WHERE learner_id = $1",
        uuid.UUID(account.learner_id),
    )
    assert [d["status"] for d in disputes] == ["open"]
    attempt = await rows(
        database,
        "SELECT verdict FROM review_attempts WHERE learner_id = $1",
        uuid.UUID(account.learner_id),
    )
    assert attempt[0]["verdict"] == "incorrect"


async def test_sync_requires_a_signed_in_learner(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    response = await client.post(
        "/v1/sync/reviews", json={"records": [record(mcq(catalog), correct=True, at=T0)]}
    )
    assert response.status_code == 401
