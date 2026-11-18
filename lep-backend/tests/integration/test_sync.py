"""Offline bundles (Phase 9): the content manifest and a learner's sync bundle."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.config import DEFAULT_CONTENT_DIR, Settings
from app.content.catalog import ContentCatalog, load_catalog_cached
from app.services.sync import WINDOW_DAYS, WINDOW_UNITS
from tests.factories import OffsetClock
from tests.integration.api import bearer, signed_up
from tests.integration.conftest import Database, start_app
from tests.integration.test_reviews import mcq, record, sync

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def catalog() -> ContentCatalog:
    return load_catalog_cached(DEFAULT_CONTENT_DIR)


@pytest.fixture
async def cdn_client(settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
    cdn = settings.model_copy(update={"content_cdn_base_url": "https://cdn.example.org/content"})
    async with start_app(cdn, clock=OffsetClock()) as running:
        yield running.client


async def test_the_content_manifest_names_every_file_by_its_hash(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    r = await client.get("/v1/content/bundle")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["content_version"] == catalog.version
    assert body["unchanged"] is False
    assert [u["id"] for u in body["units"]] == list(catalog.unit_order())
    # the hash is the hash of exactly the bytes the API serves
    unit = body["units"][0]
    served = await client.get(unit["url"])
    assert served.status_code == 200
    assert hashlib.sha256(served.content).hexdigest() == unit["sha256"]
    assert len(served.content) == unit["bytes"]
    course = await client.get(body["course"]["url"])
    assert hashlib.sha256(course.content).hexdigest() == body["course"]["sha256"]
    # cacheable, and revalidated cheaply
    again = await client.get("/v1/content/bundle", headers={"If-None-Match": r.headers["etag"]})
    assert again.status_code == 304


async def test_a_device_on_the_current_version_downloads_nothing(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    body = (await client.get(f"/v1/content/bundle?since={catalog.version}")).json()
    assert body == {
        "content_version": catalog.version,
        "unchanged": True,
        "course": None,
        "units": [],
    }


async def test_with_a_cdn_the_urls_are_immutable_and_keyed_by_hash(
    cdn_client: httpx.AsyncClient, client: httpx.AsyncClient
) -> None:
    served = await cdn_client.get("/v1/content/bundle")
    body = served.json()
    # the same content behind other URLs is another manifest: never a 304 for the old one
    plain = await client.get("/v1/content/bundle")
    assert served.headers["etag"] != plain.headers["etag"]
    stale = await cdn_client.get(
        "/v1/content/bundle", headers={"If-None-Match": plain.headers["etag"]}
    )
    assert stale.status_code == 200
    unit = body["units"][0]
    assert unit["url"] == (
        f"https://cdn.example.org/content/units/{unit['id']}.{unit['sha256'][:16]}.json"
    )


async def test_a_new_learner_holds_the_first_five_units_and_nothing_due(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    r = await client.get("/v1/sync/bundle", headers=bearer(account.access_token))
    assert r.status_code == 200, r.text
    body = r.json()
    order = list(catalog.unit_order())
    assert body["current_unit"] == order[0]
    assert [u["id"] for u in body["units"]] == order[:WINDOW_UNITS]
    assert body["due"] == []
    assert body["due_total"] == 0
    assert body["window_days"] == WINDOW_DAYS
    assert body["content_changed"] is True
    same = await client.get(
        f"/v1/sync/bundle?since={catalog.version}", headers=bearer(account.access_token)
    )
    assert same.json()["content_changed"] is False


async def test_the_due_window_is_the_next_seven_days_soonest_first(
    client: httpx.AsyncClient, catalog: ContentCatalog, database: Database
) -> None:
    account = await signed_up(client)
    now = datetime.now(UTC)
    answered = [mcq(catalog, i) for i in range(6)]
    batch = [
        record(item, correct=k % 2 == 0, at=now - timedelta(days=3, minutes=k))
        for k, item in enumerate(answered)
    ]
    assert (await sync(client, account, batch)).status_code == 200
    body = (await client.get("/v1/sync/bundle", headers=bearer(account.access_token))).json()
    assert body["due_total"] == len(body["due"]) > 0
    due_at = [datetime.fromisoformat(d["due_at"]) for d in body["due"]]
    assert due_at == sorted(due_at)
    assert all(d <= now + timedelta(days=WINDOW_DAYS, minutes=1) for d in due_at)
    reviewed = {m for item in answered for m in item.memory_items}
    assert {d["memory_item_id"] for d in body["due"]} <= reviewed
    # a review due beyond the window is not in it
    later = body["due"][0]["memory_item_id"]
    connection = await database.connect()
    try:
        await connection.execute(
            "UPDATE memory_state SET due = $3 WHERE learner_id = $1 AND memory_item_id = $2",
            uuid.UUID(account.learner_id),
            later,
            now + timedelta(days=WINDOW_DAYS + 3),
        )
    finally:
        await connection.close()
    after = (await client.get("/v1/sync/bundle", headers=bearer(account.access_token))).json()
    assert later not in {d["memory_item_id"] for d in after["due"]}
    assert after["due_total"] == body["due_total"] - 1
    # every review can be done offline: it names an exercise that reviews it, in a unit the
    # bundle lists, and no exercise is used twice
    units = {u["id"] for u in after["units"]}
    exercises = [d["item_id"] for d in after["due"]]
    assert all(exercises), after["due"]
    assert len(set(exercises)) == len(exercises)
    for d in after["due"]:
        item = catalog.items[d["item_id"]]
        assert d["memory_item_id"] in item.memory_items, d
        assert item.unit_id in units, d


async def test_the_sync_bundle_needs_a_signed_in_learner(client: httpx.AsyncClient) -> None:
    assert (await client.get("/v1/sync/bundle")).status_code == 401
