"""Test-out, placement and the cosmetic shop, end to end."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from app.config import DEFAULT_CONTENT_DIR
from app.content.catalog import ContentCatalog, load_catalog_cached
from app.domain import shop
from tests.answers import correct_submission
from tests.integration.api import Account, bearer, signed_up

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def catalog() -> ContentCatalog:
    return load_catalog_cached(DEFAULT_CONTENT_DIR)


def wrong(sub: dict[str, Any]) -> dict[str, Any]:
    if sub["kind"] == "choice":
        # another option that exists (index + 1 is out of range for the last one, and an
        # out-of-range answer is rejected, not marked wrong)
        return {"kind": "choice", "index": sub["index"] - 1 if sub["index"] > 0 else 1}
    return {"kind": "text", "text": "zzz qqq"} if sub["kind"] == "text" else sub


async def post(
    client: httpx.AsyncClient, account: Account, path: str, body: Any = None
) -> httpx.Response:
    return await client.post(path, json=body, headers=bearer(account.access_token))


async def run_checkpoint(
    client: httpx.AsyncClient,
    account: Account,
    catalog: ContentCatalog,
    unit_id: str,
    *,
    right: bool,
) -> dict[str, Any]:
    started = await post(client, account, "/v1/assessment/checkpoints", {"unit_id": unit_id})
    assert started.status_code == 201, started.text
    form = started.json()
    assert len(form["item_ids"]) == 12
    assert form["pass_percent"] == 85
    at = datetime.now(UTC) - timedelta(minutes=10)
    records = []
    for k, item_id in enumerate(form["item_ids"]):
        sub = correct_submission(catalog.items[item_id])
        assert sub is not None
        records.append(
            {
                "kind": "review",
                "client_uuid": str(uuid.uuid4()),
                "created_at": (at + timedelta(seconds=k)).isoformat(),
                "payload": {
                    "item_id": item_id,
                    "session_id": form["checkpoint_id"],
                    "submission": sub if right else wrong(sub),
                    "rt_ms": 5000,
                    "content_version": "sha256:test",
                },
            }
        )
    synced = await post(client, account, "/v1/sync/reviews", {"records": records})
    assert synced.status_code == 200, synced.text
    done = await post(
        client, account, f"/v1/assessment/checkpoints/{form['checkpoint_id']}/complete"
    )
    assert done.status_code == 200, done.text
    result: dict[str, Any] = done.json()
    return result


async def test_passing_a_test_out_completes_the_unit(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    result = await run_checkpoint(client, account, catalog, "S01U02", right=True)
    assert result["passed"] is True
    assert result["answered"] == 12
    assert result["awards"]["units_completed"] == ["S01U02"]
    assert result["awards"]["gems"] >= 60 + 30
    progress = (await client.get("/v1/progress", headers=bearer(account.access_token))).json()
    assert any(u["unit_id"] == "S01U02" and u["completed"] for u in progress["units"])


async def test_failing_a_test_out_costs_nothing_and_can_be_retried(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    failed = await run_checkpoint(client, account, catalog, "S01U03", right=False)
    assert failed["passed"] is False
    assert failed["awards"]["gems"] == 0
    retry = await run_checkpoint(client, account, catalog, "S01U03", right=True)
    assert retry["passed"] is True


async def test_an_unknown_unit_has_no_test_out(client: httpx.AsyncClient) -> None:
    account = await signed_up(client)
    response = await post(client, account, "/v1/assessment/checkpoints", {"unit_id": "S99U99"})
    assert response.status_code == 404


async def test_placement_finds_the_first_level_not_yet_known(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    step = (await post(client, account, "/v1/assessment/placement")).json()
    stages = 0
    known = {"A1.1", "A1.2", "A2.1", "A2.2"}  # this learner knows A1–A2 and nothing above
    while not step["done"]:
        stages += 1
        assert step["unit_ids"] == sorted({catalog.items[i].unit_id for i in step["item_ids"]})
        answers = {}
        for item_id in step["item_ids"]:
            sub = correct_submission(catalog.items[item_id])
            assert sub is not None
            answers[item_id] = sub if step["level"] in known else wrong(sub)
        response = await post(
            client,
            account,
            f"/v1/assessment/placement/{step['placement_id']}/answers",
            {"answers": answers},
        )
        assert response.status_code == 200, response.text
        step = response.json()
        assert stages <= 5
    assert step["result_level"] == "B1.1"
    assert step["result_unit"] == next(
        u for u in catalog.unit_order() if catalog.units[u].cefr == "B1.1"
    )


async def test_the_shop_sells_looks_for_earned_gems_only(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    empty = (await client.get("/v1/shop", headers=bearer(account.access_token))).json()
    assert empty["gems"] == 0
    assert {i["kind"] for i in empty["items"]} <= {"pip_outfit", "theme", "path_skin"}
    poor = await post(client, account, "/v1/shop/purchase", {"item_id": "outfit.doppi"})
    assert poor.status_code == 409
    assert poor.json()["type"] == "shop_refused"
    # +90 gems, and +15 for any quest the twelve answers happened to finish
    await run_checkpoint(client, account, catalog, "S01U02", right=True)
    balance = (await client.get("/v1/shop", headers=bearer(account.access_token))).json()["gems"]
    assert balance >= 90
    bought = await post(client, account, "/v1/shop/purchase", {"item_id": "outfit.doppi"})
    assert bought.status_code == 200, bought.text
    after = bought.json()
    assert after["gems"] == balance - shop.BY_ID["outfit.doppi"].price
    assert next(i for i in after["items"] if i["id"] == "outfit.doppi")["owned"] is True
    twice = await post(client, account, "/v1/shop/purchase", {"item_id": "outfit.doppi"})
    assert twice.status_code == 409
    worn = await post(client, account, "/v1/shop/equip", {"item_id": "outfit.doppi"})
    assert next(i for i in worn.json()["items"] if i["id"] == "outfit.doppi")["equipped"] is True
    not_mine = await post(client, account, "/v1/shop/equip", {"item_id": "outfit.astronaut"})
    assert not_mine.status_code == 409


def test_nothing_in_the_shop_touches_learning() -> None:
    assert {i.kind for i in shop.CATALOGUE} <= shop.KINDS
    banned = ("freeze", "repair", "heart", "energy", "lesson", "hint", "test", "unlock", "xp")
    assert not [i.id for i in shop.CATALOGUE if any(b in i.id for b in banned)]


async def test_concurrent_purchases_never_spend_a_balance_twice(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    await run_checkpoint(client, account, catalog, "S01U02", right=True)
    balance = (await client.get("/v1/shop", headers=bearer(account.access_token))).json()["gems"]
    # 60 and 80: either fits, both do not
    assert 80 <= balance < 140
    buys = await asyncio.gather(
        post(client, account, "/v1/shop/purchase", {"item_id": "outfit.doppi"}),
        post(client, account, "/v1/shop/purchase", {"item_id": "outfit.ikat_scarf"}),
    )
    assert sorted(r.status_code for r in buys) == [200, 409]
    shop_now = (await client.get("/v1/shop", headers=bearer(account.access_token))).json()
    assert shop_now["gems"] >= 0
