"""GET /v1/course and GET /v1/units/{unit_id}, end to end."""

from __future__ import annotations

import httpx
import pytest

pytestmark = pytest.mark.integration


async def test_the_course_map_lists_every_unit_without_items(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/course")
    assert response.status_code == 200
    assert response.headers["etag"].startswith('"sha256:')
    assert "max-age" in response.headers["cache-control"]
    body = response.json()
    assert body["totals"]["units"] == 168
    assert sum(len(s["units"]) for s in body["sections"]) == 168
    unit = body["sections"][0]["units"][0]
    assert unit["id"] == "S01U01"
    assert [n["kind"] for n in unit["nodes"]][3] == "story"
    assert "tiers" not in unit["nodes"][0]
    assert body["instructions"]["instr.tap_pairs"]["en"]


async def test_a_unit_carries_nodes_vocabulary_grammar_and_story(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/units/S05U12")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "S05U12"
    assert len(body["nodes"]) == 8
    assert body["lexemes"]
    assert body["grammar"]
    assert body["story"]["body"]


async def test_an_unchanged_resource_is_a_304(client: httpx.AsyncClient) -> None:
    first = await client.get("/v1/units/S01U01")
    again = await client.get("/v1/units/S01U01", headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 304
    assert again.content == b""
    other = await client.get("/v1/units/S01U02", headers={"If-None-Match": first.headers["etag"]})
    assert other.status_code == 200


async def test_unknown_and_malformed_unit_ids(client: httpx.AsyncClient) -> None:
    missing = await client.get("/v1/units/S99U99")
    assert missing.status_code == 404
    assert missing.json()["type"] == "not_found"
    malformed = await client.get("/v1/units/hello")
    assert malformed.status_code == 422
