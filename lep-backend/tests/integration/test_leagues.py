"""Opt-in weekly leagues (docs/16 E23), end to end: joining, the table, settlement, leaving."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest

from app.config import DEFAULT_CONTENT_DIR
from app.content.catalog import ContentCatalog, ItemRecord, load_catalog_cached
from app.domain import leagues as lg
from app.workers.tasks import settle_league_weeks_async
from tests.answers import correct_submission
from tests.factories import OffsetClock
from tests.integration.api import Account, bearer, signed_up
from tests.integration.conftest import Database, worker_settings_for

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def catalog() -> ContentCatalog:
    return load_catalog_cached(DEFAULT_CONTENT_DIR)


def _items(catalog: ContentCatalog, n: int, *, offset: int = 0) -> list[ItemRecord]:
    found: list[ItemRecord] = []
    for node in ("S01U01N1", "S01U01N2", "S01U01N3"):
        for tier in (1, 2, 3):
            found += [i for i in catalog.items_in(node, tier) if correct_submission(i)]
    return found[offset : offset + n]


def _answer(item: ItemRecord, at: datetime) -> dict[str, Any]:
    return {
        "kind": "review",
        "client_uuid": str(uuid.uuid4()),
        "created_at": at.isoformat(),
        "monotonic_ms": 0,
        "payload": {
            "item_id": item.id,
            "session_id": str(uuid.uuid4()),
            "submission": correct_submission(item),
            "rt_ms": 5000,
            "hints_used": 0,
            "plays_used": 0,
            "content_version": "sha256:test",
            "local_verdict": "correct",
        },
    }


async def _earn(
    client: httpx.AsyncClient,
    account: Account,
    catalog: ContentCatalog,
    n: int,
    at: datetime,
    *,
    offset: int = 0,
) -> None:
    records = [_answer(i, at) for i in _items(catalog, n, offset=offset)]
    response = await client.post(
        "/v1/sync/reviews", json={"records": records}, headers=bearer(account.access_token)
    )
    assert response.status_code == 200, response.text


async def _patch(client: httpx.AsyncClient, account: Account, **body: Any) -> httpx.Response:
    return await client.patch("/v1/me/settings", json=body, headers=bearer(account.access_token))


async def _join(client: httpx.AsyncClient, account: Account, name: str) -> None:
    response = await _patch(client, account, leagues_opt_in=True, display_name=name)
    assert response.status_code == 200, response.text


async def _current(client: httpx.AsyncClient, account: Account) -> dict[str, Any]:
    response = await client.get("/v1/leagues/current", headers=bearer(account.access_token))
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_leagues_are_off_by_default(client: httpx.AsyncClient, clock: OffsetClock) -> None:
    account = await signed_up(client)
    status = await _current(client, account)
    assert status["opted_in"] is False
    assert status["eligible"] is True
    assert status["tier"] == 1
    assert status["league"] is None
    assert status["result"] is None
    ends = datetime.fromisoformat(status["week_ends_at"])
    assert ends == lg.week_of(clock.now()).ends_at
    assert (ends.weekday(), ends.hour, ends.minute) == (6, 15, 0)  # Sunday 20:00 in Tashkent
    me = (await client.get("/v1/me", headers=bearer(account.access_token))).json()
    assert me["display_name"] is None
    assert me["settings"]["leagues_opt_in"] is False
    assert me["settings"]["league_tier"] == 1


async def test_a_learner_who_might_be_a_minor_cannot_join(
    client: httpx.AsyncClient, clock: OffsetClock
) -> None:
    account = await signed_up(client, birth_year=clock.now().year - 16)
    response = await _patch(client, account, leagues_opt_in=True, display_name="Young One")
    assert response.status_code == 403
    assert response.json()["type"] == "leagues_not_for_minors"
    status = await _current(client, account)
    assert status["eligible"] is False
    assert status["opted_in"] is False
    # nothing of the refused request was kept
    me = (await client.get("/v1/me", headers=bearer(account.access_token))).json()
    assert me["display_name"] is None


async def test_joining_needs_a_display_name(client: httpx.AsyncClient) -> None:
    account = await signed_up(client)
    refused = await _patch(client, account, leagues_opt_in=True)
    assert refused.status_code == 409
    assert refused.json()["type"] == "display_name_required"
    for bad in ("me@example.com", "a", "site.com"):
        invalid = await _patch(client, account, display_name=bad)
        assert invalid.status_code == 422, bad
        assert invalid.json()["errors"][0]["field"] == "display_name"
    await _join(client, account, "  Aziz  K ")
    me = (await client.get("/v1/me", headers=bearer(account.access_token))).json()
    assert me["display_name"] == "Aziz K"
    assert me["settings"]["leagues_opt_in"] is True
    # the name cannot be removed while in leagues; it can be changed
    cleared = await _patch(client, account, display_name=None)
    assert cleared.status_code == 409
    assert (await _patch(client, account, display_name="Aziz")).status_code == 200
    # leaving and removing it in one request is fine
    assert (
        await _patch(client, account, leagues_opt_in=False, display_name=None)
    ).status_code == 200


async def test_xp_puts_opted_in_learners_in_one_group_ranked_by_weekly_xp(
    client: httpx.AsyncClient, catalog: ContentCatalog, clock: OffsetClock
) -> None:
    aziz, sarah, quiet = [await signed_up(client) for _ in range(3)]
    await _join(client, aziz, "Aziz")
    await _join(client, sarah, "Sarah")
    # opted in, but no XP yet this week: in no group
    assert (await _current(client, aziz))["league"] is None

    now = clock.now()
    await _earn(client, aziz, catalog, 3, now)
    await _earn(client, sarah, catalog, 8, now)
    await _earn(client, quiet, catalog, 5, now)  # never opted in

    status = await _current(client, aziz)
    league = status["league"]
    assert league is not None
    assert league["tier"] == 1
    rows = league["members"]
    assert [r["display_name"] for r in rows] == ["Sarah", "Aziz"]
    assert [r["rank"] for r in rows] == [1, 2]
    assert [r["you"] for r in rows] == [False, True]
    assert rows[0]["weekly_xp"] > rows[1]["weekly_xp"] > 0
    assert all(r["zone"] == "up" for r in rows)  # tier 1: the top 7, nobody moves down
    # rows carry a display name and weekly XP, nothing that identifies or compares more
    assert set(rows[0]) == {"rank", "display_name", "weekly_xp", "you", "zone"}
    assert (await _current(client, sarah))["league"]["id"] == league["id"]
    assert (await _current(client, quiet))["league"] is None


async def test_re_grind_xp_does_not_count(
    client: httpx.AsyncClient, catalog: ContentCatalog, clock: OffsetClock, database: Database
) -> None:
    account = await signed_up(client)
    await _join(client, account, "Bobur")
    await _earn(client, account, catalog, 3, clock.now())
    before = (await _current(client, account))["league"]["members"][0]["weekly_xp"]
    connection = await database.connect()
    try:
        await connection.execute(
            "INSERT INTO xp_events (learner_id, id, ts, day, source, xp_centi, regrind) "
            "VALUES ($1, $2, $3, $4, 'answer', 100000, true)",
            uuid.UUID(account.learner_id),
            uuid.uuid4(),
            clock.now(),
            clock.now().date(),
        )
    finally:
        await connection.close()
    after = (await _current(client, account))["league"]["members"][0]["weekly_xp"]
    assert after == before


async def test_a_paused_streak_skips_the_week(
    client: httpx.AsyncClient, catalog: ContentCatalog, clock: OffsetClock
) -> None:
    account = await signed_up(client)
    await _join(client, account, "Kamola")
    paused = await client.post(
        "/v1/gamification/streak/pause", json={"days": 3}, headers=bearer(account.access_token)
    )
    assert paused.status_code == 200, paused.text
    await _earn(client, account, catalog, 3, clock.now())
    assert (await _current(client, account))["league"] is None


async def test_the_week_settles_once_and_the_result_waits_for_the_next_open(
    client: httpx.AsyncClient, catalog: ContentCatalog, clock: OffsetClock
) -> None:
    account = await signed_up(client)
    await _join(client, account, "Dilnoza")
    await _earn(client, account, catalog, 3, clock.now())
    week = lg.week_of(clock.now())

    clock.advance(timedelta(days=8))
    status = await _current(client, account)
    assert status["tier"] == 2
    assert status["league"] is None  # a new week, no XP in it yet
    result = status["result"]
    assert (result["rank"], result["moved"]) == (1, 1)
    assert (result["tier_before"], result["tier_after"]) == (1, 2)
    assert result["members"] == 1
    assert result["weekly_xp"] > 0
    assert datetime.fromisoformat(result["week_ends_at"]) == week.ends_at
    # shown once
    seen = await client.post("/v1/leagues/result-seen", headers=bearer(account.access_token))
    assert seen.status_code == 204
    assert (await _current(client, account))["result"] is None
    history = await client.get("/v1/leagues/history", headers=bearer(account.access_token))
    assert history.status_code == 200
    weeks = history.json()["weeks"]
    assert [w["tier_after"] for w in weeks] == [2]
    assert history.json()["next_cursor"] is None

    # the next week's XP puts the learner in a tier-2 group
    await _earn(client, account, catalog, 3, clock.now(), offset=3)
    assert (await _current(client, account))["league"]["tier"] == 2


async def test_leaving_takes_the_learner_out_and_the_tier_is_kept_four_weeks(
    client: httpx.AsyncClient, catalog: ContentCatalog, clock: OffsetClock
) -> None:
    aziz, sarah = await signed_up(client), await signed_up(client)
    await _join(client, aziz, "Aziz")
    await _join(client, sarah, "Sarah")
    await _earn(client, aziz, catalog, 3, clock.now())
    await _earn(client, sarah, catalog, 3, clock.now())
    assert len((await _current(client, sarah))["league"]["members"]) == 2

    assert (await _patch(client, aziz, leagues_opt_in=False)).status_code == 200
    assert (await _current(client, aziz))["league"] is None
    assert [r["display_name"] for r in (await _current(client, sarah))["league"]["members"]] == [
        "Sarah"
    ]

    # Sarah's week settles: tier 2. She leaves and comes back within four weeks: still tier 2
    clock.advance(timedelta(days=8))
    assert (await _current(client, sarah))["tier"] == 2
    assert (await _patch(client, sarah, leagues_opt_in=False)).status_code == 200
    clock.advance(timedelta(weeks=3))
    assert (await _patch(client, sarah, leagues_opt_in=True)).status_code == 200
    assert (await _current(client, sarah))["tier"] == 2
    # after more than four weeks away she starts again at 1
    assert (await _patch(client, sarah, leagues_opt_in=False)).status_code == 200
    clock.advance(timedelta(weeks=4, days=1))
    assert (await _patch(client, sarah, leagues_opt_in=True)).status_code == 200
    assert (await _current(client, sarah))["tier"] == 1


async def test_the_sunday_job_settles_every_ended_week_once(
    client: httpx.AsyncClient, catalog: ContentCatalog, clock: OffsetClock, database: Database
) -> None:
    accounts = [await signed_up(client) for _ in range(3)]
    for i, account in enumerate(accounts):
        await _join(client, account, f"Learner {chr(65 + i)}")
        await _earn(client, account, catalog, 2 + 2 * i, clock.now())
    settings = worker_settings_for(database)
    assert await settle_league_weeks_async(settings, now=clock.now()) == 0  # not ended yet
    later = clock.now() + timedelta(days=8)
    assert await settle_league_weeks_async(settings, now=later) == 1
    assert await settle_league_weeks_async(settings, now=later) == 0
    clock.advance(timedelta(days=8))
    results = [(await _current(client, a))["result"] for a in accounts]
    assert sorted(r["rank"] for r in results) == [1, 2, 3]
    assert all(r["moved"] == 1 and r["members"] == 3 for r in results)


async def test_league_rows_are_in_the_data_export_and_go_with_the_account(
    client: httpx.AsyncClient, catalog: ContentCatalog, clock: OffsetClock
) -> None:
    account = await signed_up(client)
    await _join(client, account, "Exporter")
    await _earn(client, account, catalog, 2, clock.now())
    export = await client.get("/v1/me/export", headers=bearer(account.access_token))
    assert export.status_code == 200, export.text
    assert len(export.json()["league_members"]) == 1
    # the learner's history is theirs; nobody else's row is in it
    assert all(r["learner_id"] == account.learner_id for r in export.json()["league_members"])
