# ruff: noqa: ARG002 — fakes keep the ports' signatures
"""Phase 8: audio assets, synthesised speech, voice recordings, raters and the data controls."""

from __future__ import annotations

import base64
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import asyncpg
import httpx
import pytest
from pydantic import SecretStr

from app.ai.rater import Rating
from app.config import Settings
from app.domain.pronunciation import Measurement, Phone, Word
from app.domain.rubric import CRITERIA, CriterionScore
from app.media.ports import Synthesised
from app.workers.tasks import purge_expired_recordings_async, seed_assets_async
from tests.factories import PASSWORD, OffsetClock
from tests.integration.api import Account, bearer, signed_up
from tests.integration.conftest import Database, start_app, worker_settings_for

pytestmark = pytest.mark.integration

FAKE_KEY = "sk-ant-api03-THIS-IS-A-FAKE-KEY-ab12cd34ef56gh78ij90"
AUDIO = base64.b64encode(b"OggS" + b"\x00" * 2000).decode()
ITEM = "item.0000001"


@dataclass
class FakeScorer:
    version: str = "fake-asr:1"
    calls: list[str | None] = field(default_factory=list)

    async def measure(self, audio: bytes, mime: str, expected: str | None) -> Measurement:
        self.calls.append(expected)
        word = Word("hello", (Phone("h", "h", 85), Phone("ə", "ə", 80), Phone("l", "l", 90)))
        transcript = "I live in Tashkent with my family. I like my city because it is green."
        return Measurement(
            (word,),
            independent_wer=0.05,
            transcript=transcript,
            speech_rate_wpm=110,
            pause_ratio=0.2,
        )


@dataclass
class FakeSpeakingRater:
    version: str = "fake-speaking:1"

    async def rate(
        self,
        *,
        level: str,
        prompt: str,
        transcript: str,
        wpm: float | None,
        pause_ratio: float | None,
    ) -> Rating:
        return Rating(
            [
                CriterionScore(c, 2.0, ("I live in Tashkent with my family",))
                for c in CRITERIA["speaking"]
                if c != "phonology"
            ],
            self.version,
        )


@dataclass
class FakeTts:
    version: str = "fake-voice:1"
    calls: list[str] = field(default_factory=list)

    async def synthesise(self, text: str) -> Synthesised:
        self.calls.append(text)
        return Synthesised(b"OggS" + text.encode(), "audio/ogg", 500)


@dataclass
class Running:
    client: httpx.AsyncClient
    container: Any


async def _running(
    settings: Settings, *, scorer: bool = True, **over: Any
) -> AsyncIterator[Running]:
    s = settings.model_copy(update=over) if over else settings
    async with start_app(s, clock=OffsetClock()) as app:
        c = app.app.state.container
        if scorer:
            c.speech = FakeScorer()
            c.speaking_rater = FakeSpeakingRater()
            c.tts = FakeTts()
        yield Running(app.client, c)


@pytest.fixture
async def media_app(settings: Settings, tmp_path: Path) -> AsyncIterator[Running]:
    async for r in _running(settings, media_dir=tmp_path):
        yield r


async def consent(
    client: httpx.AsyncClient, account: Account, on: bool = True, **more: Any
) -> None:
    r = await client.patch(
        "/v1/me/settings", json={"voice_consent": on, **more}, headers=bearer(account.access_token)
    )
    assert r.status_code == 200, r.text


async def speak(client: httpx.AsyncClient, account: Account, **over: Any) -> httpx.Response:
    body = {
        "purpose": "pronunciation",
        "audio_base64": AUDIO,
        "mime": "audio/ogg",
        "seconds": 3,
        "item_id": ITEM,
        **over,
    }
    return await client.post("/v1/media/speech", json=body, headers=bearer(account.access_token))


# ------------------------------------------------------------------- keys never leave the server


async def test_no_provider_key_is_reachable_from_any_client_response(settings: Settings) -> None:
    s = settings.model_copy(update={"ai_api_key": SecretStr(FAKE_KEY)})
    async with start_app(s, clock=OffsetClock()) as app:
        client = app.client
        account = await signed_up(client)
        h = bearer(account.access_token)
        bodies = [
            (await client.get(path, headers=h)).text
            for path in (
                "/openapi.json",
                "/v1/me",
                "/v1/me/export",
                "/v1/ai/status",
                "/v1/gamification/summary",
                "/v1/progress",
                "/v1/progress/level/A1",
                "/v1/assessment/writing-tasks?level=A1",
                "/v1/assessment/speaking-tasks?level=A1",
                "/health",
                "/ready",
            )
        ]
        bodies.append((await client.post("/v1/media/tts", json={"text": "hello"}, headers=h)).text)
        bodies.append((await speak(client, account)).text)
    for body in bodies:
        assert FAKE_KEY not in body
        assert "sk-ant-" not in body


# ------------------------------------------------------------------- recordings


async def test_without_a_scorer_speech_is_unavailable_and_nothing_is_stored(
    settings: Settings,
) -> None:
    async for r in _running(settings, scorer=False):
        account = await signed_up(r.client)
        await consent(r.client, account)
        resp = await speak(r.client, account)
        assert resp.status_code == 503
        assert resp.json()["type"] == "media_unavailable"


async def test_consent_is_required_and_a_pronunciation_attempt_is_scored_after_the_response(
    media_app: Running,
) -> None:
    client = media_app.client
    account = await signed_up(client)
    refused = await speak(client, account)
    assert refused.status_code == 409
    assert refused.json()["reason"] == "consent"

    await consent(client, account)
    accepted = await speak(client, account)
    assert accepted.status_code == 202, accepted.text
    job = accepted.json()
    assert job["status"] == "queued"
    assert datetime.fromisoformat(job["expires_at"]) - datetime.now(UTC) <= timedelta(
        days=30, minutes=1
    )

    polled = (
        await client.get(f"/v1/media/jobs/{job['id']}", headers=bearer(account.access_token))
    ).json()
    assert polled["status"] == "scored"
    result = polled["result"]
    assert 0 <= result["headline"] <= 100
    assert len(result["notes"]) <= 2
    assert result["words"][0]["word"] == "hello"
    assert result["scorer"] == "fake-asr:1"


async def test_a_speaking_task_becomes_a_rubric_score_with_evidence_and_prompt_version(
    media_app: Running, database: Database
) -> None:
    client = media_app.client
    account = await signed_up(client)
    await consent(client, account)
    job = (
        await speak(
            client, account, purpose="speaking_task", item_id=None, task_id="s.A2.1", seconds=40
        )
    ).json()
    result = (
        await client.get(f"/v1/media/jobs/{job['id']}", headers=bearer(account.access_token))
    ).json()["result"]
    assert result["score_id"] is not None
    conn = await database.connect()
    try:
        row = await conn.fetchrow(
            "SELECT kind, prompt_version, criteria, overall, certifying FROM rubric_scores WHERE id = $1",
            uuid.UUID(result["score_id"]),
        )
    finally:
        await conn.close()
    assert row is not None
    assert row["kind"] == "speaking"
    assert row["prompt_version"] == "speaking-rater-2026-10-04"
    assert row["certifying"] is False
    import json

    criteria = json.loads(row["criteria"])
    assert set(criteria) == set(CRITERIA["speaking"])
    assert all(c["evidence"] for c in criteria.values())
    # free speech: phonology comes from intelligibility, never from GOP without an expected text
    assert criteria["phonology"]["evidence"][0].startswith("intelligibility")


async def test_a_rubric_score_without_evidence_or_prompt_version_is_refused_by_the_database(
    database: Database,
) -> None:
    conn = await database.connect()
    try:
        lid = uuid.uuid4()
        await conn.execute(
            "INSERT INTO learners (id, email, password_hash, l1, birth_year, tz) VALUES ($1, $2, 'x', 'uz', 2000, 'UTC')",
            lid,
            f"{lid}@example.com",
        )
        for prompt, criteria in (("p1", "{}"), (None, '{"lexis": {"band": 3, "evidence": ["x"]}}')):
            with pytest.raises(asyncpg.CheckViolationError):
                await conn.execute(
                    "INSERT INTO rubric_scores (learner_id, id, submission_id, level, kind, rater_kind, rater_version, "
                    "prompt_version, criteria, overall, certifying, borderline, created_at) "
                    "VALUES ($1, $2, $3, 'B1', 'writing', 'llm', 'v', $4, $5::jsonb, 3, false, false, now())",
                    lid,
                    uuid.uuid4(),
                    uuid.uuid4(),
                    prompt,
                    criteria,
                )
    finally:
        await conn.close()


async def test_recordings_expire_and_are_purged_on_schedule(
    media_app: Running, database: Database
) -> None:
    client = media_app.client
    account = await signed_up(client)
    await consent(client, account)
    job = (await speak(client, account)).json()
    worker = worker_settings_for(database)

    assert (await purge_expired_recordings_async(worker))["recordings"] == 0
    purged = await purge_expired_recordings_async(
        worker, now=datetime.now(UTC) + timedelta(days=31)
    )
    assert purged["recordings"] >= 1
    gone = await client.get(f"/v1/media/jobs/{job['id']}", headers=bearer(account.access_token))
    assert gone.status_code == 404
    conn = await database.connect()
    try:
        reason = await conn.fetchval(
            "SELECT reason FROM recording_tombstones WHERE recording_id = $1", uuid.UUID(job["id"])
        )
        audio_left = await conn.fetchval(
            "SELECT count(*) FROM recordings WHERE id = $1", uuid.UUID(job["id"])
        )
    finally:
        await conn.close()
    assert reason == "expired"
    assert audio_left == 0


async def test_withdrawing_consent_or_asking_deletes_the_recordings(media_app: Running) -> None:
    client = media_app.client
    account = await signed_up(client)
    h = bearer(account.access_token)
    await consent(client, account)
    first = (await speak(client, account)).json()
    await consent(client, account, on=False)
    assert (await client.get(f"/v1/media/jobs/{first['id']}", headers=h)).status_code == 404

    await consent(client, account)
    await speak(client, account)
    deleted = (await client.delete("/v1/me/recordings", headers=h)).json()
    assert deleted == {"deleted": 1}


async def test_pausing_data_collection_refuses_recordings_and_writing(media_app: Running) -> None:
    client = media_app.client
    account = await signed_up(client)
    await consent(client, account, data_collection_paused=True)
    r = await speak(client, account)
    assert r.status_code == 409
    assert r.json()["reason"] == "paused"
    w = await client.post(
        "/v1/assessment/writing",
        json={"task_id": "w.A1.1", "text": "My name is Ali and I live in Tashkent with my family."},
        headers=bearer(account.access_token),
    )
    assert w.status_code == 409


async def test_the_daily_speech_ceiling(settings: Settings, tmp_path: Path) -> None:
    async for r in _running(settings, media_dir=tmp_path, speech_seconds_per_day=10):
        account = await signed_up(r.client)
        await consent(r.client, account)
        assert (await speak(r.client, account, seconds=6)).status_code == 202
        over = await speak(r.client, account, seconds=6)
        assert over.status_code == 409
        assert over.json()["reason"] == "ceiling"


# ------------------------------------------------------------------- the learner's data


async def test_export_includes_everything_but_secrets(media_app: Running) -> None:
    client = media_app.client
    account = await signed_up(client)
    await consent(client, account)
    await speak(client, account)
    exported = (await client.get("/v1/me/export", headers=bearer(account.access_token))).json()
    assert exported["learner"]["id"] == account.learner_id
    assert "password_hash" not in exported["learner"]
    assert "refresh_tokens" not in exported
    assert len(exported["recordings"]) == 1
    assert base64.b64decode(exported["recordings"][0]["audio"]).startswith(b"OggS")
    assert exported["learner_settings"][0]["voice_consent"] is True


async def test_deleting_the_account_needs_the_password_and_removes_everything(
    media_app: Running, database: Database
) -> None:
    client = media_app.client
    account = await signed_up(client)
    h = bearer(account.access_token)
    await consent(client, account)
    job = (await speak(client, account)).json()
    wrong = await client.post("/v1/me/delete", json={"password": "not it"}, headers=h)
    assert wrong.status_code == 401
    done = await client.post("/v1/me/delete", json={"password": PASSWORD}, headers=h)
    assert done.status_code == 204, done.text
    assert (await client.get("/v1/me", headers=h)).status_code == 401
    conn = await database.connect()
    try:
        lid = uuid.UUID(account.learner_id)
        assert await conn.fetchval("SELECT count(*) FROM learners WHERE id = $1", lid) == 0
        assert (
            await conn.fetchval("SELECT count(*) FROM recordings WHERE learner_id = $1", lid) == 0
        )
        assert (
            await conn.fetchval(
                "SELECT reason FROM recording_tombstones WHERE recording_id = $1",
                uuid.UUID(job["id"]),
            )
            == "account"
        )
    finally:
        await conn.close()


# ------------------------------------------------------------------- audio assets and TTS


async def test_every_referenced_audio_is_recorded_honestly_as_missing(
    media_app: Running, database: Database
) -> None:
    added = await seed_assets_async(worker_settings_for(database))
    from app.config import DEFAULT_CONTENT_DIR
    from app.content.catalog import load_catalog_cached
    from app.services.media import asset_texts

    # every distinct item audio file the content refers to, each with the text it should say
    assert added == len(asset_texts(load_catalog_cached(DEFAULT_CONTENT_DIR)))
    assert await seed_assets_async(worker_settings_for(database)) == 0
    account = await signed_up(media_app.client)
    asset = (
        await media_app.client.get(
            "/v1/media/assets/a/lex.00001_ga.opus", headers=bearer(account.access_token)
        )
    ).json()
    assert asset["status"] == "missing"
    assert asset["source"] == "none"
    assert asset["url"] is None
    assert asset["text"] == "hello"


async def test_tts_drafts_are_marked_synthetic(media_app: Running, database: Database) -> None:
    from app.services.media import tts_drafts

    await seed_assets_async(worker_settings_for(database))
    tts = FakeTts()
    made = await tts_drafts(
        media_app.container.sessionmaker,
        tts,
        media_app.container.settings.media_dir,
        datetime.now(UTC),
        limit=3,
    )
    assert made == {"made": 3, "failed": 0}
    account = await signed_up(media_app.client)
    conn = await database.connect()
    try:
        path = await conn.fetchval(
            "SELECT path FROM media_assets WHERE status = 'tts_draft' ORDER BY path LIMIT 1"
        )
    finally:
        await conn.close()
    asset = (
        await media_app.client.get(f"/v1/media/assets/{path}", headers=bearer(account.access_token))
    ).json()
    assert asset["source"] == "synthetic"
    assert asset["url"] == f"/v1/media/files/{path}"
    audio = await media_app.client.get(asset["url"], headers=bearer(account.access_token))
    assert audio.status_code == 200
    assert audio.content.startswith(b"OggS")


async def test_on_demand_speech_is_cached_and_has_a_daily_ceiling(
    settings: Settings, tmp_path: Path
) -> None:
    async for r in _running(settings, media_dir=tmp_path, tts_chars_per_day=30):
        account = await signed_up(r.client)
        h = bearer(account.access_token)
        first = await r.client.post("/v1/media/tts", json={"text": "Nice to meet you."}, headers=h)
        assert first.status_code == 200, first.text
        assert first.json()["source"] == "synthetic"
        again = await r.client.post("/v1/media/tts", json={"text": "Nice to meet you."}, headers=h)
        assert again.json()["url"] == first.json()["url"]
        assert r.container.tts.calls == ["Nice to meet you."]
        over = await r.client.post(
            "/v1/media/tts", json={"text": "This is a rather longer sentence."}, headers=h
        )
        assert over.status_code == 409
        escape = await r.client.get("/v1/media/files/..%2F..%2Fsecret", headers=h)
        assert escape.status_code in (404, 422)


# ------------------------------------------------------------------- regressions from review


@dataclass
class BrokenScorer:
    version: str = "broken:1"
    error: Exception = field(default_factory=lambda: RuntimeError("adapter bug"))

    async def measure(self, audio: bytes, mime: str, expected: str | None) -> Measurement:
        raise self.error


async def test_a_scorer_failure_settles_the_recording_and_gives_the_seconds_back(
    settings: Settings, tmp_path: Path
) -> None:
    from app.media.ports import ProviderUnavailable

    for error in (RuntimeError("adapter bug"), ProviderUnavailable("down")):
        async for r in _running(settings, media_dir=tmp_path, speech_seconds_per_day=10):
            r.container.speech = BrokenScorer(error=error)
            account = await signed_up(r.client)
            await consent(r.client, account)
            job = (await speak(r.client, account, seconds=8)).json()
            polled = (
                await r.client.get(
                    f"/v1/media/jobs/{job['id']}", headers=bearer(account.access_token)
                )
            ).json()
            assert polled["status"] == "failed"
            # the 8 seconds came back: another 8-second recording fits under the 10-second ceiling
            assert (await speak(r.client, account, seconds=8)).status_code == 202


async def test_the_length_charged_is_proven_by_the_audio_not_taken_from_the_client(
    settings: Settings, tmp_path: Path
) -> None:
    async for r in _running(settings, media_dir=tmp_path, max_recording_seconds=30):
        account = await signed_up(r.client)
        await consent(r.client, account)
        # 400 kB of compressed audio cannot be one second long: at least 50 s, over the 30 s cap
        big = base64.b64encode(b"OggS" + b"\x00" * 400_000).decode()
        r1 = await speak(r.client, account, seconds=1, audio_base64=big)
        assert r1.status_code == 422


async def test_an_expired_recording_is_gone_before_the_nightly_purge(
    media_app: Running, database: Database
) -> None:
    client = media_app.client
    account = await signed_up(client)
    await consent(client, account)
    job = (await speak(client, account)).json()
    conn = await database.connect()
    try:
        await conn.execute(
            "UPDATE recordings SET expires_at = now() - interval '1 minute' WHERE id = $1",
            uuid.UUID(job["id"]),
        )
    finally:
        await conn.close()
    h = bearer(account.access_token)
    assert (await client.get(f"/v1/media/jobs/{job['id']}", headers=h)).status_code == 404
    exported = (await client.get("/v1/me/export", headers=h)).json()
    assert exported["recordings"] == []
    assert exported["recording_count"] == 0


async def test_a_nul_byte_in_a_media_path_is_refused_cleanly(media_app: Running) -> None:
    account = await signed_up(media_app.client)
    r = await media_app.client.get(
        "/v1/media/files/a%00b.ogg", headers=bearer(account.access_token)
    )
    assert r.status_code in (404, 422)
