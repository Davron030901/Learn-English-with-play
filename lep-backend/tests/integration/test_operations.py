"""Operations (Phase 9): graceful shutdown, and the load test against a real server.

Both run the API under uvicorn on a real socket, as it runs in production, rather than through
the in-process test transport.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import time
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
import uvicorn
from pydantic import SecretStr
from sqlalchemy import event

from app import main as main_module
from app.api.v1 import reviews as reviews_api
from app.config import DEFAULT_CONTENT_DIR, ENV_PREFIX, Settings
from app.content.catalog import ContentCatalog, load_catalog_cached
from app.main import build_app
from app.repositories.reviews import ReviewRepository
from scripts import loadtest
from tests.factories import OffsetClock
from tests.integration.api import bearer, signed_up
from tests.integration.conftest import Database, start_app
from tests.integration.test_reviews import mcq, record, sync

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def catalog() -> ContentCatalog:
    return load_catalog_cached(DEFAULT_CONTENT_DIR)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port: int = s.getsockname()[1]
        return port


async def test_a_graceful_shutdown_finishes_the_writes_in_flight(
    settings: Settings,
    database: Database,
    catalog: ContentCatalog,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entered = asyncio.Event()
    events: list[str] = []
    original_insert = ReviewRepository.insert_attempts
    original_close = getattr(main_module, "close_container")  # noqa: B009 — patched below

    async def slow_insert(self: ReviewRepository, rows: Any) -> None:
        # inside the ingest transaction: the learner's lock is held and a pooled connection
        # is checked out when the shutdown begins
        entered.set()
        await asyncio.sleep(1.0)
        await original_insert(self, rows)
        events.append("written")

    async def recorded_close(container: Any) -> None:
        events.append("pools closed")
        await original_close(container)

    original_ingest = reviews_api._ingest

    async def recorded_ingest(*args: Any, **kwargs: Any) -> Any:
        result = await original_ingest(*args, **kwargs)
        events.append("committed")  # the handler's transaction has committed
        return result

    monkeypatch.setattr(ReviewRepository, "insert_attempts", slow_insert)
    monkeypatch.setattr(reviews_api, "_ingest", recorded_ingest)
    monkeypatch.setattr(main_module, "close_container", recorded_close)
    port = _free_port()
    server = uvicorn.Server(
        uvicorn.Config(
            build_app(settings, clock=OffsetClock()),
            host="127.0.0.1",
            port=port,
            log_level="warning",
            timeout_graceful_shutdown=30,
        )
    )
    serving = asyncio.create_task(server.serve())
    for _ in range(200):
        if server.started:
            break
        await asyncio.sleep(0.05)
    assert server.started
    base = f"http://127.0.0.1:{port}"
    async with httpx.AsyncClient(base_url=base, timeout=30) as client:
        account = await signed_up(client)
        t0 = datetime.now(UTC) - timedelta(hours=1)
        batch = [
            record(mcq(catalog, i), correct=True, at=t0 + timedelta(seconds=i)) for i in range(40)
        ]
        in_flight = asyncio.create_task(sync(client, account, batch))
        await asyncio.wait_for(entered.wait(), 10)
        server.should_exit = True  # what SIGTERM does
        await asyncio.sleep(0.5)
        # no new connection is taken once the shutdown has begun
        async with httpx.AsyncClient(base_url=base, timeout=2) as late:
            with pytest.raises(httpx.TransportError):
                await late.get("/health")
        response = await in_flight
    await asyncio.wait_for(serving, 30)
    # the pools close last: after the in-flight write has committed
    assert events == ["written", "committed", "pools closed"], events
    assert response.status_code == 200, response.text
    assert all(r["status"] == "accepted" for r in response.json()["results"])
    connection = await database.connect()
    try:
        stored = await connection.fetchval(
            "SELECT count(*) FROM review_attempts WHERE learner_id = $1",
            uuid.UUID(account.learner_id),
        )
    finally:
        await connection.close()
    assert stored == len(batch), "every answer of the in-flight batch was written"


# ------------------------------------------------------------------- load (opt-in)


def _environment(settings: Settings) -> dict[str, str]:
    """The settings as the LEP_* variables a separate API process reads."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(ENV_PREFIX)}
    for name, value in settings.model_dump().items():
        if value is None:
            continue
        if isinstance(value, SecretStr):
            value = value.get_secret_value()
        elif isinstance(value, list | tuple):
            value = ",".join(str(v) for v in value)
        elif isinstance(value, bool):
            value = "true" if value else "false"
        env[f"{ENV_PREFIX}{name.upper()}"] = str(value)
    return env


@pytest.fixture
def api_process(settings: Settings) -> Iterator[str]:
    port = _free_port()
    workers = os.environ.get("LEP_LOAD_WORKERS", "1")
    settings = settings.model_copy(update={"log_level": "WARNING"})
    process = subprocess.Popen(  # noqa: S603 — our own interpreter and module
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:create_app",
            "--factory",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--workers",
            workers,
            "--no-access-log",
            "--log-level",
            "warning",
        ],
        cwd=ROOT,
        env=_environment(settings),
    )
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                if httpx.get(f"{base}/health", timeout=2).status_code == 200:
                    break
            except httpx.TransportError:
                pass
            if process.poll() is not None:
                pytest.fail(f"the API process exited with {process.returncode}")
            time.sleep(0.5)
        else:
            pytest.fail("the API process did not become healthy")
        yield base
    finally:
        process.terminate()
        process.wait(timeout=60)


@pytest.mark.load
@pytest.mark.skipif(not os.environ.get("LEP_LOAD"), reason="set LEP_LOAD=1 to run the load test")
async def test_the_hot_path_meets_its_p99_at_the_target_concurrency(api_process: str) -> None:
    learners = int(os.environ.get("LEP_LOAD_LEARNERS", "50"))
    seconds = float(os.environ.get("LEP_LOAD_SECONDS", "60"))
    result = await loadtest.run(api_process, learners=learners, seconds=seconds)
    report = json.dumps(result, indent=2)
    print(report)  # the numbers are the point of this test
    out = os.environ.get("LEP_LOAD_REPORT")
    if out:
        await asyncio.to_thread(Path(out).write_text, report, encoding="utf-8")
    problems = loadtest.verdict(result, float(os.environ.get("LEP_LOAD_P99_MS", "300")))
    assert not problems, problems


# ------------------------------------------------------------------- round trips


class _Statements:
    """Counts the SQL statements the API sends (a deterministic proxy for latency: every
    statement is a network round trip, whatever the machine)."""

    def __init__(self) -> None:
        self.count = 0

    def __call__(self, *_: Any) -> None:
        self.count += 1


async def test_the_hot_path_makes_few_round_trips_whatever_the_batch_size(
    settings: Settings, catalog: ContentCatalog
) -> None:
    async with start_app(settings, clock=OffsetClock()) as running:
        counter = _Statements()
        engine = running.app.state.container.engine.sync_engine
        event.listen(engine, "before_cursor_execute", counter)
        try:
            account = await signed_up(running.client)
            headers = bearer(account.access_token)
            node = next(
                n for n in catalog.nodes.values() if n.unit_id == "S01U01" and n.tiers.get(1)
            )
            t0 = datetime.now(UTC) - timedelta(hours=2)

            async def statements(call: Any) -> int:
                before = counter.count
                response = await call
                assert response.status_code in (200, 201), response.text
                return counter.count - before

            opened = await statements(
                running.client.post(
                    "/v1/sessions",
                    json={"minutes": 10, "node_id": node.id, "tier": 1},
                    headers=headers,
                )
            )
            small = await statements(
                sync(
                    running.client,
                    account,
                    [
                        record(mcq(catalog, i), correct=True, at=t0 + timedelta(seconds=i))
                        for i in range(10)
                    ],
                )
            )
            large = await statements(
                sync(
                    running.client,
                    account,
                    [
                        record(
                            mcq(catalog, 40 + i),
                            correct=i % 3 > 0,
                            at=t0 + timedelta(minutes=5, seconds=i),
                        )
                        for i in range(60)
                    ],
                )
            )
            due = await statements(running.client.get("/v1/reviews/due", headers=headers))
        finally:
            event.remove(engine, "before_cursor_execute", counter)
    assert opened <= 12, opened
    assert small <= 26, small
    assert large <= small + 2, (small, large)  # writes are batched, not one per answer
    assert due <= 4, due
