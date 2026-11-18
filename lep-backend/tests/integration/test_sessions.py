"""Composed sessions (backend brief Phase 5), end to end against PostgreSQL."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from app.config import DEFAULT_CONTENT_DIR
from app.content.catalog import ContentCatalog, ItemRecord, load_catalog_cached
from app.domain.composer import MAX_MODALITY_RUN, MAX_TARGET_RUN, MAX_TYPE_RUN
from tests.answers import correct_submission
from tests.factories import OffsetClock
from tests.integration.api import Account, bearer, signed_up
from tests.integration.conftest import Database

pytestmark = pytest.mark.integration

TZ = "Asia/Tashkent"


@pytest.fixture(scope="module")
def catalog() -> ContentCatalog:
    return load_catalog_cached(DEFAULT_CONTENT_DIR)


def answer(item: ItemRecord, at: datetime) -> dict[str, Any]:
    sub = correct_submission(item)
    assert sub is not None, item.id
    return {
        "kind": "review",
        "client_uuid": str(uuid.uuid4()),
        "created_at": at.isoformat(),
        "monotonic_ms": 0,
        "payload": {
            "item_id": item.id,
            "session_id": str(uuid.uuid4()),
            "submission": sub,
            "rt_ms": 5000,
            "hints_used": 0,
            "plays_used": 0,
            "content_version": "sha256:test",
            "local_verdict": "correct",
        },
    }


def answerable(catalog: ContentCatalog, node_id: str, tier: int = 1) -> list[ItemRecord]:
    return [i for i in catalog.items_in(node_id, tier) if correct_submission(i) is not None]


async def post(
    client: httpx.AsyncClient, account: Account, path: str, body: Any = None
) -> httpx.Response:
    return await client.post(path, json=body, headers=bearer(account.access_token))


def run_ok(steps: list[dict[str, Any]]) -> None:
    """The three interleaving rules, checked on what the API actually returned: a run may only
    grow past its limit where a lesson item is placed (the new block keeps its authored order
    and is never dropped, docs/08 §5 step 4); the review block never breaks one."""
    items = [s for s in steps if s["role"] != "break"]
    for key, limit in (
        ("target", MAX_TARGET_RUN),
        ("type_id", MAX_TYPE_RUN),
        ("modality", MAX_MODALITY_RUN),
    ):
        run, prev = 0, None
        for s in items:
            run = run + 1 if s[key] == prev else 1
            prev = s[key]
            if run > limit:
                assert s["role"] == "lesson", (key, [(x["role"], x[key]) for x in items])


async def test_a_new_learner_gets_new_material_within_the_cap(client: httpx.AsyncClient) -> None:
    account = await signed_up(client, tz=TZ)
    r = await post(client, account, "/v1/sessions", {"minutes": 10})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "practice"
    assert body["status"] == "open"
    roles = {s["role"] for s in body["steps"]}
    assert roles == {"lesson"}, "nothing is due yet, so it is all new material"
    assert 0 < len(body["new_targets"]) <= body["new_cap"] == 15
    assert body["estimated_seconds"] <= 10 * 60 * 1.1
    assert all(s["unit_id"] == "S01U01" for s in body["steps"])
    run_ok(body["steps"])
    assert body["catching_up"] == {
        "due": 0,
        "normal_per_day": 60,
        "days_left": 0,
        "new_allowed": True,
    }

    # five minutes is never new material (no time to consolidate)
    short = (await post(client, account, "/v1/sessions", {"minutes": 5})).json()
    assert short["steps"] == []


async def test_due_reviews_come_first_with_a_warm_up_and_a_close(
    client: httpx.AsyncClient, catalog: ContentCatalog, clock: OffsetClock
) -> None:
    account = await signed_up(client, tz=TZ)
    t0 = datetime.now(UTC) - timedelta(hours=1)
    items = answerable(catalog, "S01U01N1") + answerable(catalog, "S01U01N2")
    synced = await post(
        client,
        account,
        "/v1/sync/reviews",
        {"records": [answer(i, t0 + timedelta(seconds=k)) for k, i in enumerate(items)]},
    )
    assert synced.status_code == 200, synced.text
    clock.advance(timedelta(days=6))

    body = (await post(client, account, "/v1/sessions", {"minutes": 10})).json()
    roles = [s["role"] for s in body["steps"]]
    assert "review" in roles
    assert body["catching_up"]["due"] > 0
    reviews = [s for s in body["steps"] if s["role"] == "review"]
    assert len({s["memory_item_id"] for s in reviews}) == len(reviews)
    if "close" in roles:
        closing = body["steps"][-1]
        assert closing["role"] == "close"
        assert closing["memory_item_id"] in {s["memory_item_id"] for s in reviews}
    run_ok(body["steps"])


async def test_a_node_session_plays_the_tier(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ)
    r = await post(client, account, "/v1/sessions", {"minutes": 15, "node_id": "S01U01N1"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["kind"], body["node_id"], body["tier"]) == ("node", "S01U01N1", 1)
    lesson = [s for s in body["steps"] if s["role"] == "lesson"]
    tier_items = {i.id for i in catalog.items_in("S01U01N1", 1)}
    assert lesson
    assert {s["item_id"] for s in lesson} <= tier_items
    placed = {s["item_id"] for s in lesson} | set(body["deferred"])
    assert len(placed) >= 0.6 * len(tier_items), "most of the tier is played"
    run_ok(body["steps"])


async def _tiers(
    database: Database, learner_id: str, node_id: str, done: dict[int, datetime]
) -> None:
    conn = await database.connect()
    try:
        for tier, at in done.items():
            await conn.execute(
                "INSERT INTO node_progress (learner_id, node_id, tier, completed_at, accuracy) "
                "VALUES ($1, $2, $3, $4, 0.9)",
                uuid.UUID(learner_id),
                node_id,
                tier,
                at,
            )
    finally:
        await conn.close()


async def test_tier_3_opens_three_days_after_tier_2(
    client: httpx.AsyncClient, database: Database, clock: OffsetClock
) -> None:
    account = await signed_up(client, tz=TZ)
    node = "S01U01N1"
    real = datetime.now(UTC)
    t2 = real - timedelta(days=2, hours=23)
    await _tiers(database, account.learner_id, node, {1: t2 - timedelta(days=1), 2: t2})

    early = await post(client, account, "/v1/sessions", {"minutes": 10, "node_id": node, "tier": 3})
    assert early.status_code == 409, early.text
    problem = early.json()
    assert problem["type"] == "tier_locked"
    opens = datetime.fromisoformat(problem["available_at"])
    assert abs((opens - (t2 + timedelta(days=3))).total_seconds()) < 1

    clock.advance(timedelta(hours=1, minutes=1))  # now 3 days 1 minute after tier 2
    late = await post(client, account, "/v1/sessions", {"minutes": 10, "node_id": node, "tier": 3})
    assert late.status_code == 201, late.text
    assert late.json()["tier"] == 3


async def test_tier_2_needs_tier_1(client: httpx.AsyncClient) -> None:
    account = await signed_up(client, tz=TZ)
    r = await post(
        client, account, "/v1/sessions", {"minutes": 10, "node_id": "S01U01N1", "tier": 2}
    )
    assert r.status_code == 409
    assert r.json()["type"] == "tier_locked"


async def test_the_daily_new_cap_refuses_a_further_lesson(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ)
    t0 = datetime.now(UTC) - timedelta(minutes=30)
    # meet a full day of new targets: unit 1's lessons
    items = [i for n in ("S01U01N1", "S01U01N2", "S01U01N3") for i in answerable(catalog, n)]
    await post(
        client,
        account,
        "/v1/sync/reviews",
        {"records": [answer(i, t0 + timedelta(seconds=k)) for k, i in enumerate(items)]},
    )
    practice = (await post(client, account, "/v1/sessions", {"minutes": 10})).json()
    assert practice["new_today"] >= 15
    assert practice["new_targets"] == []
    refused = await post(client, account, "/v1/sessions", {"minutes": 10, "node_id": "S01U02N1"})
    assert refused.status_code == 409, refused.text
    assert refused.json()["type"] == "new_items_capped"


async def test_resume_complete_and_privacy(client: httpx.AsyncClient) -> None:
    account = await signed_up(client, tz=TZ)
    made = (await post(client, account, "/v1/sessions", {"minutes": 10})).json()
    again = await client.get(f"/v1/sessions/{made['id']}", headers=bearer(account.access_token))
    assert again.status_code == 200
    assert again.json()["steps"] == made["steps"]
    assert again.json()["catching_up"] is None

    done = (await post(client, account, f"/v1/sessions/{made['id']}/complete")).json()
    assert done["status"] == "completed"
    twice = (await post(client, account, f"/v1/sessions/{made['id']}/complete")).json()
    assert twice["completed_at"] == done["completed_at"]

    other = await signed_up(client, tz=TZ)
    hidden = await client.get(f"/v1/sessions/{made['id']}", headers=bearer(other.access_token))
    assert hidden.status_code == 404


async def test_bad_requests(client: httpx.AsyncClient) -> None:
    account = await signed_up(client, tz=TZ)
    assert (await post(client, account, "/v1/sessions", {"minutes": 0})).status_code == 422
    assert (
        await post(client, account, "/v1/sessions", {"minutes": 10, "tier": 2})
    ).status_code == 422
    assert (
        await post(client, account, "/v1/sessions", {"minutes": 10, "node_id": "S99U01N1"})
    ).status_code == 404


# ------------------------------------------------------------------- accessibility (F19)

NO_AUDIO_EXCLUDED = {"minimal_pair_discrimination", "phoneme_id"}
PRODUCTION = {
    "repeat_after",
    "speak_prompt",
    "read_aloud",
    "speak_roleplay",
    "speak_retell",
    "write_sentence",
}


def _node_with(catalog: ContentCatalog, types: set[str], *, at_least: float = 0.0) -> str:
    """The first tier-1 node whose share of ``types`` is above ``at_least``."""
    for node in catalog.nodes.values():
        ids = node.tiers.get(1, ())
        hit = sum(catalog.items[i].type_id in types for i in ids)
        if ids and hit and hit / len(ids) > at_least:
            return node.id
    raise AssertionError("no such node")


async def test_the_profile_chooses_what_a_session_holds(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client, tz=TZ)
    node = _node_with(catalog, NO_AUDIO_EXCLUDED)
    sound_only = {
        i for i in catalog.nodes[node].tiers[1] if catalog.items[i].type_id in NO_AUDIO_EXCLUDED
    }

    plain = (await post(client, account, "/v1/sessions", {"minutes": 10, "node_id": node})).json()
    assert plain["withheld"] == []
    assert plain["a11y_profile"] == {"no_audio": False, "no_vision": False}
    assert sound_only <= {s.get("item_id") for s in plain["steps"]}

    # the request's profile
    asked = await post(
        client,
        account,
        "/v1/sessions",
        {"minutes": 10, "node_id": node, "a11y_profile": {"no_audio": True}},
    )
    assert asked.status_code == 201, asked.text
    body = asked.json()
    assert set(body["withheld"]) == sound_only
    assert body["a11y_profile"] == {"no_audio": True, "no_vision": False}
    assert not {s.get("type_id") for s in body["steps"] + body["recovery"]} & NO_AUDIO_EXCLUDED

    # the saved profile, and a request that overrides it
    saved = await client.patch(
        "/v1/me/settings", json={"a11y_no_audio": True}, headers=bearer(account.access_token)
    )
    assert saved.status_code == 200, saved.text
    me = (await client.get("/v1/me", headers=bearer(account.access_token))).json()
    assert me["settings"]["a11y_no_audio"] is True
    assert me["settings"]["a11y_no_vision"] is False
    by_settings = (
        await post(client, account, "/v1/sessions", {"minutes": 10, "node_id": node})
    ).json()
    assert set(by_settings["withheld"]) == sound_only
    overridden = (
        await post(
            client,
            account,
            "/v1/sessions",
            {"minutes": 10, "node_id": node, "a11y_profile": {"no_audio": False}},
        )
    ).json()
    assert overridden["withheld"] == []

    again = await client.get(f"/v1/sessions/{body['id']}", headers=bearer(account.access_token))
    assert again.json()["withheld"] == body["withheld"]
    assert again.json()["a11y_profile"] == body["a11y_profile"]

    bad = await post(
        client,
        account,
        "/v1/sessions",
        {"minutes": 10, "a11y_profile": {"no_audio": True, "colour": "blind"}},
    )
    assert bad.status_code == 422


async def test_every_step_has_its_phase(client: httpx.AsyncClient) -> None:
    account = await signed_up(client, tz=TZ)
    body = (
        await post(client, account, "/v1/sessions", {"minutes": 15, "node_id": "S01U01N1"})
    ).json()
    lesson = [s for s in body["steps"] if s["role"] == "lesson"]
    for s in lesson:
        expected = {"production"} if s["type_id"] in PRODUCTION else {"guided", "integration"}
        assert s["phase"] in expected, s
    practice = [s["phase"] for s in lesson if s["type_id"] not in PRODUCTION]
    assert practice[0] == "guided"
    assert practice == sorted(practice, key=["guided", "integration"].index)
    for s in body["steps"]:
        if s["role"] != "lesson":
            assert s["phase"] == s["role"], s


async def test_reviews_and_the_offline_window_respect_the_saved_profile(
    client: httpx.AsyncClient, catalog: ContentCatalog, clock: OffsetClock
) -> None:
    account = await signed_up(client, tz=TZ)
    node = _node_with(catalog, NO_AUDIO_EXCLUDED)
    items = answerable(catalog, node)
    t0 = datetime.now(UTC) - timedelta(hours=1)
    synced = await post(
        client,
        account,
        "/v1/sync/reviews",
        {"records": [answer(i, t0 + timedelta(seconds=k)) for k, i in enumerate(items)]},
    )
    assert synced.status_code == 200, synced.text
    patched = await client.patch(
        "/v1/me/settings", json={"a11y_no_audio": True}, headers=bearer(account.access_token)
    )
    assert patched.status_code == 200, patched.text
    clock.advance(timedelta(days=6))

    due = (
        await client.get("/v1/reviews/due?limit=60", headers=bearer(account.access_token))
    ).json()
    assert due["items"], "something is due"
    assert not {catalog.items[d["item_id"]].type_id for d in due["items"]} & NO_AUDIO_EXCLUDED

    bundle = (await client.get("/v1/sync/bundle", headers=bearer(account.access_token))).json()
    chosen = [d["item_id"] for d in bundle["due"] if d["item_id"]]
    assert chosen
    assert not {catalog.items[i].type_id for i in chosen} & NO_AUDIO_EXCLUDED


async def test_a_tier_is_passed_on_what_the_profile_can_show(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    """A node-tier mostly made of sound-only items: a learner who cannot hear passes it on the
    items they can be shown; the same answers in a session planned for hearing do not."""
    node = _node_with(catalog, NO_AUDIO_EXCLUDED, at_least=0.5)

    async def play(profile: dict[str, bool] | None) -> list[Any]:
        """Answer every lesson item a no-audio plan holds, in a session planned for ``profile``
        (None: a session the server did not compose — the saved settings decide)."""
        account = await signed_up(client, tz=TZ)
        plan = (
            await post(
                client,
                account,
                "/v1/sessions",
                {"minutes": 10, "node_id": node, "a11y_profile": {"no_audio": True}},
            )
        ).json()
        session_id = plan["id"]
        if profile is None:
            session_id = str(uuid.uuid4())
            await client.patch(
                "/v1/me/settings",
                json={"a11y_no_audio": True},
                headers=bearer(account.access_token),
            )
        elif not profile["no_audio"]:
            hearing = await post(client, account, "/v1/sessions", {"minutes": 10, "node_id": node})
            session_id = hearing.json()["id"]
        t0 = datetime.now(UTC) - timedelta(minutes=10)
        records = []
        for k, s in enumerate(x for x in plan["steps"] if x["role"] == "lesson"):
            item = catalog.items[s["item_id"]]
            if correct_submission(item) is None:
                continue
            record = answer(item, t0 + timedelta(seconds=10 * k))
            record["payload"]["session_id"] = session_id
            records.append(record)
        assert records
        synced = await post(client, account, "/v1/sync/reviews", {"records": records})
        assert synced.status_code == 200, synced.text
        summary = await client.get(
            f"/v1/sessions/{session_id}/summary", headers=bearer(account.access_token)
        )
        assert summary.status_code == 200, summary.text
        nodes: list[Any] = summary.json()["nodes_completed"]
        return nodes

    assert [n["node_id"] for n in await play({"no_audio": True})] == [node]
    assert [n["node_id"] for n in await play(None)] == [node], "the saved profile decides"
    assert await play({"no_audio": False}) == [], "a hearing session needs the sound items"


async def _known(database: Database, learner_id: str, items: list[ItemRecord]) -> None:
    """Memory items reviewed yesterday with a long stability: p(correct) ≈ 0.99 now."""
    now = datetime.now(UTC)
    conn = await database.connect()
    try:
        for item in items:
            for m in item.memory_items:
                await conn.execute(
                    "INSERT INTO memory_state (learner_id, memory_item_id, stability, difficulty,"
                    " due, last_review, last_review_day, reviews_today, reps, lapses,"
                    " lapses_last_30_days, state, last_item_id, last_type_id, scheduler_version)"
                    " VALUES ($1, $2, 120, 3, $3, $4, $5, 1, 6, 0, 0, 'retained', $6, $7, 'test')"
                    " ON CONFLICT DO NOTHING",
                    uuid.UUID(learner_id),
                    m,
                    now + timedelta(days=60),
                    now - timedelta(days=1),
                    (now - timedelta(days=1)).date(),
                    item.id,
                    item.type_id,
                )
    finally:
        await conn.close()


async def test_a_plan_carries_recovery_items_the_learner_is_sure_of(
    client: httpx.AsyncClient, catalog: ContentCatalog, database: Database
) -> None:
    account = await signed_up(client, tz=TZ)
    await _known(database, account.learner_id, list(catalog.items_in("S01U01N1", 1)))
    body = (
        await post(client, account, "/v1/sessions", {"minutes": 10, "node_id": "S01U01N2"})
    ).json()
    recovery = body["recovery"]
    assert 1 <= len(recovery) <= 2
    in_plan = {s["item_id"] for s in body["steps"] if s.get("item_id")}
    for s in recovery:
        assert (s["role"], s["phase"]) == ("recovery", "integration")
        assert s["item_id"] not in in_plan
        assert s["new_targets"] == []
    assert len({s["type_id"] for s in recovery}) == len(recovery)
    assert body["estimated_seconds"] == pytest.approx(
        sum(s["seconds"] for s in body["steps"]), abs=0.5
    )


async def test_what_nothing_can_review_for_the_profile_is_not_due(
    client: httpx.AsyncClient, catalog: ContentCatalog, clock: OffsetClock
) -> None:
    """Memory items only sound-only exercises review: learned with sound, then the learner
    turns sound off — they are not due any more, and do not grow the backlog."""
    from app.services.progress import _indexes

    ix = _indexes(catalog)
    sound_only = [
        m
        for m, items in ix.items_for.items()
        if items and all(catalog.items[i].type_id in NO_AUDIO_EXCLUDED for i in items)
    ]
    assert sound_only, "the content has memory items only sound-only exercises review"
    items = []
    for m in sorted(sound_only)[:6]:
        item = catalog.items[ix.items_for[m][0]]
        if correct_submission(item) is not None:
            items.append(item)
    assert items
    account = await signed_up(client, tz=TZ)
    t0 = datetime.now(UTC) - timedelta(hours=1)
    synced = await post(
        client,
        account,
        "/v1/sync/reviews",
        {"records": [answer(i, t0 + timedelta(seconds=k)) for k, i in enumerate(items)]},
    )
    assert synced.status_code == 200, synced.text
    clock.advance(timedelta(days=30))
    h = bearer(account.access_token)
    hearing = (await client.get("/v1/reviews/due", headers=h)).json()["total_due"]
    assert hearing > 0

    await client.patch("/v1/me/settings", json={"a11y_no_audio": True}, headers=h)
    assert (await client.get("/v1/reviews/due", headers=h)).json()["total_due"] == 0
    session = (await post(client, account, "/v1/sessions", {"minutes": 10})).json()
    assert session["catching_up"]["due"] == 0
    assert (await client.get("/v1/sync/bundle", headers=h)).json()["due_total"] == 0
    garden = (await client.get("/v1/garden/summary", headers=h)).json()
    assert garden["est_minutes"] == 0
