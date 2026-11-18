"""The award pipeline, streak care, settings, progress and the garden, end to end."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from app.config import DEFAULT_CONTENT_DIR
from app.content.catalog import ContentCatalog, ItemRecord, load_catalog_cached
from app.domain.streaks import local_day
from tests.answers import correct_submission
from tests.integration.api import Account, bearer, signed_up

pytestmark = pytest.mark.integration

TZ = "Asia/Tashkent"


@pytest.fixture(scope="module")
def catalog() -> ContentCatalog:
    return load_catalog_cached(DEFAULT_CONTENT_DIR)


def now() -> datetime:
    return datetime.now(UTC)


def answer(
    item: ItemRecord, at: datetime, *, session: uuid.UUID | None = None, rt_ms: int = 5000
) -> dict[str, Any]:
    sub = correct_submission(item)
    assert sub is not None, item.id
    return {
        "kind": "review",
        "client_uuid": str(uuid.uuid4()),
        "created_at": at.isoformat(),
        "monotonic_ms": 0,
        "payload": {
            "item_id": item.id,
            "session_id": str(session or uuid.uuid4()),
            "submission": sub,
            "rt_ms": rt_ms,
            "hints_used": 0,
            "plays_used": 0,
            "content_version": "sha256:test",
            "local_verdict": "correct",
        },
    }


async def sync(
    client: httpx.AsyncClient, account: Account, records: list[dict[str, Any]]
) -> dict[str, Any]:
    response = await client.post(
        "/v1/sync/reviews", json={"records": records}, headers=bearer(account.access_token)
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def get(client: httpx.AsyncClient, account: Account, path: str) -> dict[str, Any]:
    response = await client.get(path, headers=bearer(account.access_token))
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def tier_items(catalog: ContentCatalog, node_id: str, tier: int) -> list[ItemRecord]:
    return list(catalog.items_in(node_id, tier))


async def test_answers_earn_xp_and_credit_the_streak(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ)
    items = tier_items(catalog, "S01U01N1", 1)[:4]
    body = await sync(
        client, account, [answer(i, now() - timedelta(seconds=60 - k)) for k, i in enumerate(items)]
    )
    awards = body["awards"]
    assert awards["xp"] > 0
    assert awards["streak"]["current"] == 1
    assert awards["streak"]["today_counted"] is True
    summary = await get(client, account, "/v1/gamification/summary")
    assert summary["xp_today"] == summary["xp_total"] >= 1
    assert len(summary["daily_quests"]) == 3
    assert len(summary["weekly_quests"]) == 2
    assert summary["gems"] == 0


async def test_the_daily_goal_pays_ten_gems_once(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ, daily_goal_min=5)
    items = tier_items(catalog, "S01U01N1", 1)[:3]
    # 3 × (100 s + 3 s) ≥ 5 minutes of time on task
    body = await sync(
        client,
        account,
        [answer(i, now() - timedelta(seconds=30 - k), rt_ms=100_000) for k, i in enumerate(items)],
    )
    assert body["awards"]["goal"]["met"] is True
    assert body["awards"]["goal"]["met_now"] is True
    assert body["awards"]["gems"] >= 10
    again = await sync(
        client, account, [answer(items[0], now() - timedelta(seconds=5), rt_ms=100_000)]
    )
    assert again["awards"]["goal"]["met_now"] is False


async def test_a_passed_node_tier_is_recorded_once(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ)
    session = uuid.uuid4()
    items = tier_items(catalog, "S01U01N1", 1)
    start = now() - timedelta(minutes=30)
    body = await sync(
        client,
        account,
        [
            answer(i, start + timedelta(seconds=10 * k), session=session)
            for k, i in enumerate(items)
        ],
    )
    assert {"node_id": "S01U01N1", "tier": 1} in body["awards"]["nodes_completed"]
    summary = await get(client, account, f"/v1/sessions/{session}/summary")
    assert summary["answers"] == len(items)
    assert summary["nodes_completed"] == [{"node_id": "S01U01N1", "tier": 1}]
    progress = await get(client, account, "/v1/progress")
    assert progress["current_unit"] == "S01U01"
    assert progress["units"][0]["tiers"]["S01U01N1"] == 1


async def test_tier_3_waits_three_days_after_tier_2(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ)
    t2 = tier_items(catalog, "S01U01N1", 2)
    t3 = tier_items(catalog, "S01U01N1", 3)
    base = now() - timedelta(days=5)
    s2, s3, s3b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    first = await sync(
        client,
        account,
        [answer(i, base + timedelta(seconds=k), session=s2) for k, i in enumerate(t2)],
    )
    too_soon = await sync(
        client,
        account,
        [answer(i, base + timedelta(days=2, seconds=k), session=s3) for k, i in enumerate(t3)],
    )
    assert {"node_id": "S01U01N1", "tier": 2} in first["awards"]["nodes_completed"]
    assert {"node_id": "S01U01N1", "tier": 3} not in too_soon["awards"]["nodes_completed"]
    later = await sync(
        client,
        account,
        [
            answer(i, base + timedelta(days=3, minutes=1, seconds=k), session=s3b)
            for k, i in enumerate(t3)
        ],
    )
    assert {"node_id": "S01U01N1", "tier": 3} in later["awards"]["nodes_completed"]


async def test_finishing_a_unit_stamps_its_can_do_statements(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ)
    unit = catalog.units["S01U01"]
    records: list[dict[str, Any]] = []
    at = now() - timedelta(hours=3)
    for node_id in unit.node_ids:
        node = catalog.nodes[node_id]
        if node.kind not in ("lesson", "story", "speak") or not node.tiers:
            continue
        tier = min(2, max(node.tiers))
        session = uuid.uuid4()
        for item in tier_items(catalog, node_id, tier):
            at += timedelta(seconds=20)
            records.append(answer(item, at, session=session))
    body = await sync(client, account, records)
    awards = body["awards"]
    assert awards["units_completed"] == ["S01U01"]
    assert [b["id"] for b in awards["badges"]] == [
        f"S01U01:{i}" for i in range(1, len(unit.can_do) + 1)
    ]
    assert awards["badges"][0]["text"] == unit.can_do[0]
    assert awards["gems"] >= 30
    progress = await get(client, account, "/v1/progress")
    assert progress["units"][0]["completed"] is True
    assert len(progress["badges"]) == len(unit.can_do)
    summary = await get(client, account, "/v1/gamification/summary")
    assert len(summary["unseen_badges"]) == len(unit.can_do)
    seen = await client.post(
        "/v1/gamification/badges/seen",
        json={"ids": [b["id"] for b in summary["unseen_badges"]]},
        headers=bearer(account.access_token),
    )
    assert seen.status_code == 204
    assert (await get(client, account, "/v1/gamification/summary"))["unseen_badges"] == []


async def test_a_replayed_batch_awards_nothing_twice(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ)
    records = [
        answer(i, now() - timedelta(minutes=5, seconds=-k))
        for k, i in enumerate(tier_items(catalog, "S01U01N1", 1))
    ]
    first = await sync(client, account, records)
    again = await sync(client, account, records)
    assert first["awards"]["xp"] > 0
    assert again["awards"]["xp"] == 0
    assert again["awards"]["gems"] == 0
    assert {r["status"] for r in again["results"]} == {"duplicate"}


async def test_the_streak_spends_free_freezes_then_resets_kindly_and_can_be_repaired(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ, daily_goal_min=5)
    item = tier_items(catalog, "S01U01N1", 1)[0]
    today = now()
    # learned 7 and 6 days ago; days 5, 4 are frozen; day 3 breaks; nothing since
    await sync(
        client,
        account,
        [answer(item, today - timedelta(days=7)), answer(item, today - timedelta(days=6))],
    )
    summary = await get(client, account, "/v1/gamification/summary")
    assert summary["streak"]["current"] == 0
    assert summary["streak"]["freezes"] == 0
    assert summary["streak"]["reset_message"].startswith("Your streak reset. That's fine")
    assert summary["streak"]["can_repair"] is False  # broke 3 days ago: outside 48 h
    ack = await client.post(
        "/v1/gamification/streak/reset-seen", headers=bearer(account.access_token)
    )
    assert ack.status_code == 204
    assert (await get(client, account, "/v1/gamification/summary"))["streak"][
        "reset_message"
    ] is None


async def test_repair_needs_a_double_session(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ, daily_goal_min=5)
    item = tier_items(catalog, "S01U01N1", 1)[0]
    today = now()
    await sync(
        client, account, [answer(item, today - timedelta(days=d)) for d in (6, 5)]
    )  # days 4, 3 frozen; day 2 breaks; yesterday nothing
    summary = await get(client, account, "/v1/gamification/summary")
    if not summary["streak"]["can_repair"]:
        pytest.skip("the local day boundary moved the break outside the window")
    refused = await client.post(
        "/v1/gamification/streak/repair", headers=bearer(account.access_token)
    )
    assert refused.status_code == 409
    assert refused.json()["type"] == "streak_rule"
    # a double session today: ≥ 2 × 5 minutes of time on task
    items = tier_items(catalog, "S01U01N1", 1)[:6]
    await sync(
        client,
        account,
        [answer(i, today - timedelta(seconds=60 - k), rt_ms=110_000) for k, i in enumerate(items)],
    )
    repaired = await client.post(
        "/v1/gamification/streak/repair", headers=bearer(account.access_token)
    )
    assert repaired.status_code == 200, repaired.text
    assert repaired.json()["streak"]["current"] >= 2


async def test_pause_protects_the_streak(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ)
    item = tier_items(catalog, "S01U01N1", 1)[0]
    await sync(client, account, [answer(item, now() - timedelta(minutes=1))])
    paused = await client.post(
        "/v1/gamification/streak/pause", json={"days": 10}, headers=bearer(account.access_token)
    )
    assert paused.status_code == 200
    assert paused.json()["streak"]["paused_until"] is not None
    twice = await client.post(
        "/v1/gamification/streak/pause", json={"days": 3}, headers=bearer(account.access_token)
    )
    assert twice.status_code == 409
    too_long = await client.post(
        "/v1/gamification/streak/pause", json={"days": 31}, headers=bearer(account.access_token)
    )
    assert too_long.status_code == 422


async def test_settings_change_the_goal_and_reschedule_on_a_new_retention(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ)
    items = tier_items(catalog, "S01U01N1", 1)[:3]
    await sync(
        client,
        account,
        [answer(i, now() - timedelta(days=2, seconds=-k)) for k, i in enumerate(items)],
    )
    before = await get(client, account, "/v1/reviews/due?limit=60")
    patched = await client.patch(
        "/v1/me/settings",
        json={"daily_goal_min": 20, "desired_retention": 0.94, "rest_days": [6, 7]},
        headers=bearer(account.access_token),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["goal"]["goal_min"] == 20
    assert patched.json()["streak"]["rest_days"] == [6, 7]
    after = await get(client, account, "/v1/reviews/due?limit=60")
    # a thorough preset brings reviews sooner: never fewer items due
    assert after["total_due"] >= before["total_due"]
    bad = await client.patch(
        "/v1/me/settings", json={"desired_retention": 0.5}, headers=bearer(account.access_token)
    )
    assert bad.status_code == 422


async def test_the_garden_and_the_due_queue(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ)
    items = tier_items(catalog, "S01U01N1", 1)
    await sync(
        client,
        account,
        [answer(i, now() - timedelta(days=20, seconds=-k)) for k, i in enumerate(items)],
    )
    garden = await get(client, account, "/v1/garden/summary")
    assert garden["due_count"] > 0
    assert garden["stages"]["seed"] + garden["stages"]["sprout"] > 0
    beds = await get(client, account, "/v1/garden/beds")
    plant = beds["beds"][0]["plants"][0]
    assert beds["beds"][0]["unit_id"] == "S01U01"
    assert plant["thirsty"] is True
    assert 0 <= plant["health"] < 1
    due = await get(client, account, "/v1/reviews/due?limit=10")
    assert due["total_due"] > 0
    assert due["items"]
    assert all(d["item_id"] in catalog.items for d in due["items"])
    progress = await get(client, account, "/v1/progress")
    assert progress["coverage"]["known_lexemes"] == 0  # seen, not retained: never counted as known
    assert progress["coverage"]["learning_lexemes"] > 0
    assert progress["coverage"]["audited"] is False


def test_local_days_follow_the_learners_zone() -> None:
    assert local_day(datetime(2026, 10, 3, 20, 0, tzinfo=UTC), TZ).isoformat() == "2026-10-04"
