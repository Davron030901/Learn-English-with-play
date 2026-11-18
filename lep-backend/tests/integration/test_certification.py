"""Level exams, production scoring, appeals, the level award and the retention audit (Phase 7)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from app.ai.rater import Rating
from app.config import DEFAULT_CONTENT_DIR, Settings
from app.content.catalog import ContentCatalog, load_catalog_cached
from app.domain.level_award import FRAGILE_MESSAGE
from app.domain.rubric import CRITERIA, CriterionScore
from app.services.certification import level_index
from tests.answers import correct_submission
from tests.factories import OffsetClock
from tests.integration.api import Account, bearer, signed_up
from tests.integration.conftest import Database, start_app

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def catalog() -> ContentCatalog:
    return load_catalog_cached(DEFAULT_CONTENT_DIR)


async def post(
    client: httpx.AsyncClient, account: Account, path: str, body: Any = None
) -> httpx.Response:
    return await client.post(path, json=body, headers=bearer(account.access_token))


def record(
    catalog: ContentCatalog, item_id: str, session: str, at: datetime, *, right: bool = True
) -> dict[str, Any]:
    sub = correct_submission(catalog.items[item_id])
    assert sub is not None, item_id
    if not right:
        # another option that exists: index + 1 is out of range when the key is the last one,
        # and an out-of-range answer is rejected rather than marked wrong
        sub = (
            {"kind": "choice", "index": sub["index"] - 1 if sub["index"] > 0 else 1}
            if sub["kind"] == "choice"
            else {"kind": "text", "text": "zzz qqq"}
        )
    return {
        "kind": "review",
        "client_uuid": str(uuid.uuid4()),
        "created_at": at.isoformat(),
        "payload": {
            "item_id": item_id,
            "session_id": session,
            "submission": sub,
            "rt_ms": 5000,
            "content_version": "sha256:test",
        },
    }


async def sync(client: httpx.AsyncClient, account: Account, records: list[dict[str, Any]]) -> None:
    for k in range(0, len(records), 400):
        r = await post(client, account, "/v1/sync/reviews", {"records": records[k : k + 400]})
        assert r.status_code == 200, r.text


# ------------------------------------------------------------------- the exam


async def test_a_level_exam_is_scored_from_its_answers_and_never_repeats_items(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    started = await post(client, account, "/v1/assessment/exams", {"level": "A1"})
    assert started.status_code == 201, started.text
    exam = started.json()
    assert set(exam["papers"]) == {"listening", "reading", "use_of_english"}
    assert len(exam["papers"]["use_of_english"]) == 15
    assert (exam["pass_overall"], exam["pass_paper"]) == (0.75, 0.6)
    items = [i for ids in exam["papers"].values() for i in ids]
    assert all(catalog.units[catalog.items[i].unit_id].cefr.startswith("A1") for i in items)

    at = datetime.now(UTC) - timedelta(minutes=30)
    await sync(
        client,
        account,
        [record(catalog, i, exam["id"], at + timedelta(seconds=k)) for k, i in enumerate(items)],
    )
    done = (await post(client, account, f"/v1/assessment/exams/{exam['id']}/complete")).json()
    assert done["passed"] is True
    assert done["scores"] == {"listening": 1.0, "reading": 1.0, "use_of_english": 1.0}

    again = (await post(client, account, "/v1/assessment/exams", {"level": "A1"})).json()
    assert not set(items) & {i for ids in again["papers"].values() for i in ids}


async def test_unanswered_items_count_as_wrong(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    exam = (await post(client, account, "/v1/assessment/exams", {"level": "A2"})).json()
    reading = exam["papers"]["reading"]
    at = datetime.now(UTC) - timedelta(minutes=5)
    await sync(client, account, [record(catalog, i, exam["id"], at) for i in reading])
    done = (await post(client, account, f"/v1/assessment/exams/{exam['id']}/complete")).json()
    assert done["scores"]["reading"] == 1.0
    assert done["scores"]["listening"] == 0.0
    assert done["passed"] is False


# ------------------------------------------------------------------- the four conditions


async def test_a_new_learner_meets_none_of_the_four(client: httpx.AsyncClient) -> None:
    account = await signed_up(client)
    r = await client.get("/v1/progress/level/A1", headers=bearer(account.access_token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["awarded"] is False
    assert [c["name"] for c in body["conditions"]] == [
        "coverage",
        "retention",
        "exam",
        "production",
    ]
    assert all(c["passed"] is False for c in body["conditions"])
    assert body["conditions"][2]["shortfall"] == "the level exam has not been taken"
    assert body["message"] is None


async def _fragile_a1(
    database: Database, catalog: ContentCatalog, learner_id: str, retained_share: float
) -> None:
    """Every A1 node at tier 2, an exam passed, production rated — and memory only partly retained."""
    ix = level_index(catalog, "A1")
    lid = uuid.UUID(learner_id)
    now = datetime.now(UTC)
    nodes = sorted({n for ns in ix.target_nodes.values() for n in ns})
    memory = sorted(ix.memory_items)
    cut = int(len(memory) * retained_share)
    conn = await database.connect()
    try:
        await conn.executemany(
            "INSERT INTO node_progress (learner_id, node_id, tier, completed_at, accuracy) VALUES ($1, $2, 2, $3, 0.9)",
            [(lid, n, now) for n in nodes],
        )
        await conn.executemany(
            "INSERT INTO memory_state (learner_id, memory_item_id, stability, difficulty, due, last_review, "
            "last_review_day, reviews_today, reps, lapses, lapses_last_30_days, state, last_item_id, last_type_id, "
            "scheduler_version) VALUES ($1, $2, $3, 5, $4, $5, $6, 0, 4, 0, 0, $7, 'item.0000001', 'type_from_l1', 'test')",
            [
                (
                    lid,
                    m,
                    30.0 if k < cut else 5.0,
                    now + timedelta(days=20),
                    now - timedelta(days=2),
                    (now - timedelta(days=2)).date(),
                    "retained" if k < cut else "young",
                )
                for k, m in enumerate(memory)
            ],
        )
        await conn.execute(
            "INSERT INTO level_exams (learner_id, id, level, papers, created_at, ends_at, reused, "
            "completed_at, scores, passed) "
            "VALUES ($1, $2, 'A1', '{}'::jsonb, $3, $3, false, $3, $4::jsonb, true)",
            lid,
            uuid.uuid4(),
            now,
            '{"listening": 0.9, "reading": 0.85, "use_of_english": 0.88}',
        )
        # every production task of the level, each with a machine score at the band
        for kind, task_id in (("writing", "w.A1.1"), ("speaking", "s.A1.1")):
            submission = uuid.uuid4()
            await conn.execute(
                "INSERT INTO production_submissions (learner_id, id, level, kind, task_id, prompt, "
                "text, status, created_at) VALUES ($1, $2, 'A1', $3, $4, 'p', 't', 'scored', $5)",
                lid,
                submission,
                kind,
                task_id,
                now,
            )
            await conn.execute(
                "INSERT INTO rubric_scores (learner_id, id, submission_id, level, kind, rater_kind, rater_version, "
                "prompt_version, criteria, overall, certifying, borderline, created_at) "
                "VALUES ($1, $2, $3, 'A1', $4, 'llm', 'test', 'test-prompt', "
                '\'{"range": {"band": 2, "evidence": ["I live in Tashkent."]}}\'::jsonb, '
                "2, false, false, $5)",
                lid,
                uuid.uuid4(),
                submission,
                kind,
                now,
            )
    finally:
        await conn.close()


async def test_passing_the_exam_at_60_percent_retention_is_refused_with_the_honest_message(
    client: httpx.AsyncClient, catalog: ContentCatalog, database: Database
) -> None:
    account = await signed_up(client)
    await _fragile_a1(database, catalog, account.learner_id, 0.60)
    r = await post(client, account, "/v1/progress/level/A1/award")
    assert r.status_code == 200, r.text
    body = r.json()
    by = {c["name"]: c for c in body["conditions"]}
    assert by["coverage"]["passed"] is True
    assert by["exam"]["passed"] is True
    assert by["production"]["passed"] is True
    assert by["retention"]["passed"] is False
    assert by["retention"]["value"] == pytest.approx(0.60, abs=0.002)
    assert body["awarded"] is False
    assert body["message"] == FRAGILE_MESSAGE
    assert body["recorded"] is True
    conn = await database.connect()
    try:
        row = await conn.fetchrow(
            "SELECT awarded, evidence FROM level_awards WHERE learner_id = $1",
            uuid.UUID(account.learner_id),
        )
    finally:
        await conn.close()
    assert row is not None
    assert row["awarded"] is False


async def test_all_four_holding_awards_the_level(
    client: httpx.AsyncClient, catalog: ContentCatalog, database: Database
) -> None:
    account = await signed_up(client)
    await _fragile_a1(database, catalog, account.learner_id, 0.90)
    body = (await post(client, account, "/v1/progress/level/A1/award")).json()
    assert body["awarded"] is True, body
    assert body["message"] is None


# ------------------------------------------------------------------- production and its raters


@dataclass
class FakeRater:
    band: float = 2.0
    quote_from_text: bool = True
    version: str = "fake:writing:1"
    calls: list[str] = field(default_factory=list)

    async def rate(
        self,
        *,
        level: str,  # noqa: ARG002 — the fake rates every level alike
        prompt: str,  # noqa: ARG002
        text: str,
    ) -> Rating:
        self.calls.append(text)
        quote = text.split(".")[0] if self.quote_from_text else "A sentence the learner never wrote"
        return Rating(
            [CriterionScore(c, self.band, (quote,)) for c in CRITERIA["writing"]], self.version
        )


TEXT = "Last weekend I visited my grandmother in Samarkand. We cooked plov and talked a lot. It was a lovely day and I was very happy."


@pytest.fixture
async def rated_app(settings: Settings) -> AsyncIterator[tuple[httpx.AsyncClient, FakeRater]]:
    rater = FakeRater()
    async with start_app(settings, clock=OffsetClock()) as running:
        running.app.state.container.rater = rater
        yield running.client, rater


async def _calibrate(database: Database, kappa: float, level: str = "A2") -> None:
    conn = await database.connect()
    try:
        await conn.execute(
            "INSERT INTO rater_calibrations VALUES ('fake:writing:1', $1, 'writing', $2, 200, now()) "
            "ON CONFLICT (rater_version, level, kind) DO UPDATE SET kappa = EXCLUDED.kappa",
            level,
            kappa,
        )
    finally:
        await conn.close()


async def test_writing_is_rated_with_evidence_and_a_rater_below_kappa_075_cannot_certify(
    rated_app: tuple[httpx.AsyncClient, FakeRater], database: Database
) -> None:
    client, rater = rated_app
    account = await signed_up(client)

    first = await post(
        client, account, "/v1/assessment/writing", {"task_id": "w.A2.1", "text": TEXT}
    )
    assert first.status_code == 201, first.text
    score = first.json()["score"]
    assert first.json()["status"] == "scored"
    assert score["overall"] == 2.0
    assert score["certifying"] is False  # never calibrated: formative only
    assert all(
        c["evidence"] == ["Last weekend I visited my grandmother in Samarkand"]
        for c in score["criteria"]
    )

    # docs/12 §6.1: the same submission receives the same score — not rated again
    same = await post(
        client, account, "/v1/assessment/writing", {"task_id": "w.A2.1", "text": " " + TEXT}
    )
    assert same.json()["score"]["id"] == score["id"]
    assert len(rater.calls) == 1

    await _calibrate(database, 0.74)
    second = TEXT + " We went home late."
    assert (
        await post(client, account, "/v1/assessment/writing", {"task_id": "w.A2.1", "text": second})
    ).json()["score"]["certifying"] is False
    await _calibrate(database, 0.80)
    third = TEXT + " Next week we will go again."
    certified = (
        await post(client, account, "/v1/assessment/writing", {"task_id": "w.A2.1", "text": third})
    ).json()["score"]
    assert certified["certifying"] is True
    # band 2 is the A2 boundary: borderline, so a human audit is queued
    assert certified["borderline"] is True
    conn = await database.connect()
    try:
        reasons = [
            r["reason"]
            for r in await conn.fetch(
                "SELECT reason FROM human_audits WHERE learner_id = $1",
                uuid.UUID(account.learner_id),
            )
        ]
    finally:
        await conn.close()
    assert reasons == ["borderline"]
    assert len(rater.calls) == 3


async def test_a_band_with_invented_evidence_is_not_stored(
    rated_app: tuple[httpx.AsyncClient, FakeRater],
) -> None:
    client, rater = rated_app
    rater.quote_from_text = False
    account = await signed_up(client)
    body = (
        await post(client, account, "/v1/assessment/writing", {"task_id": "w.A2.1", "text": TEXT})
    ).json()
    assert body["status"] == "awaiting_rater"
    assert body["score"] is None


async def test_without_a_rater_writing_waits_for_one(client: httpx.AsyncClient) -> None:
    account = await signed_up(client)
    body = (
        await post(client, account, "/v1/assessment/writing", {"task_id": "w.A1.1", "text": TEXT})
    ).json()
    assert body["status"] == "awaiting_rater"
    too_short = await post(
        client, account, "/v1/assessment/writing", {"task_id": "w.A1.1", "text": "Hi"}
    )
    assert too_short.status_code == 422


async def test_a_score_may_be_appealed_once(
    rated_app: tuple[httpx.AsyncClient, FakeRater], database: Database
) -> None:
    client, _ = rated_app
    account = await signed_up(client)
    score = (
        await post(client, account, "/v1/assessment/writing", {"task_id": "w.A2.1", "text": TEXT})
    ).json()["score"]
    first = await post(
        client,
        account,
        "/v1/assessment/appeals",
        {"score_id": score["id"], "reason": "I think my grammar was better."},
    )
    assert first.status_code == 201, first.text
    again = await post(
        client, account, "/v1/assessment/appeals", {"score_id": score["id"], "reason": "again"}
    )
    assert again.status_code == 409
    conn = await database.connect()
    try:
        audit = await conn.fetchval(
            "SELECT count(*) FROM human_audits WHERE learner_id = $1 AND reason = 'appeal'",
            uuid.UUID(account.learner_id),
        )
    finally:
        await conn.close()
    assert audit == 1


# ------------------------------------------------------------------- the retention audit


async def test_the_retention_audit_compares_recall_with_the_prediction_and_raises_the_target(
    client: httpx.AsyncClient, catalog: ContentCatalog, database: Database
) -> None:
    account = await signed_up(client)
    lid = uuid.UUID(account.learner_id)
    now = datetime.now(UTC)
    # 30 known lexeme aspects that choice/text items review
    memory = sorted(
        {
            m
            for i in catalog.items.values()
            if i.unit_id.startswith("S01")
            and i.type_id in ("mcq_word_from_definition", "type_from_l1")
            for m in i.memory_items
            if m.startswith("lex.")
        }
    )[:30]
    conn = await database.connect()
    try:
        await conn.executemany(
            "INSERT INTO memory_state (learner_id, memory_item_id, stability, difficulty, due, last_review, "
            "last_review_day, reviews_today, reps, lapses, lapses_last_30_days, state, last_item_id, last_type_id, "
            "scheduler_version) VALUES ($1, $2, 40, 5, $3, $4, $5, 0, 5, 0, 0, 'retained', 'item.0000001', 'speak_prompt', 'test')",
            [
                (
                    lid,
                    m,
                    now + timedelta(days=30),
                    now - timedelta(days=2),
                    (now - timedelta(days=2)).date(),
                )
                for m in memory
            ],
        )
    finally:
        await conn.close()

    h = bearer(account.access_token)
    before = (await client.get("/v1/progress", headers=h)).json()["coverage"]["audited"]
    assert before is False, "an estimate until a memory check has run"

    started = await post(client, account, "/v1/assessment/audit")
    assert started.status_code == 201, started.text
    audit = started.json()
    assert len(audit["item_ids"]) == 20
    assert audit["predicted"] > 0.95

    at = now - timedelta(minutes=10)
    records = [
        record(catalog, item, audit["id"], at + timedelta(seconds=k), right=k % 2 == 0)
        for k, item in enumerate(audit["item_ids"])
    ]
    await sync(client, account, records)
    done = (await post(client, account, f"/v1/assessment/audit/{audit['id']}/complete")).json()
    # about half wrong (an arranged-words item keeps its right answer): far below the prediction
    assert 0.3 <= done["actual"] <= 0.7
    assert done["predicted"] - done["actual"] > 0.10
    assert done["raised_retention"] == 0.94

    soon = await post(client, account, "/v1/assessment/audit")
    assert soon.status_code == 409

    # the check ran: the coverage figure and the garden say so
    assert (await client.get("/v1/progress", headers=h)).json()["coverage"]["audited"] is True
    assert (await client.get("/v1/garden/summary", headers=h)).json()["audited"] is True


async def test_the_audit_needs_known_material(client: httpx.AsyncClient) -> None:
    account = await signed_up(client)
    r = await post(client, account, "/v1/assessment/audit")
    assert r.status_code == 409
    assert r.json()["reason"] == "too_few"


# ------------------------------------------------------------------- regressions from review


async def test_a_backdated_retry_never_replaces_a_wrong_exam_answer(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    exam = (await post(client, account, "/v1/assessment/exams", {"level": "A1"})).json()
    # a multiple-choice item, so the wrong answer is a valid answer that is graded wrong (a text
    # answer to a tiles or pairs item would be rejected, not marked wrong)
    paper, item = next(
        (name, i)
        for name, ids in exam["papers"].items()
        for i in ids
        if (correct_submission(catalog.items[i]) or {}).get("kind") == "choice"
    )
    now = datetime.now(UTC)
    first = await post(
        client,
        account,
        "/v1/sync/reviews",
        {"records": [record(catalog, item, exam["id"], now, right=False)]},
    )
    assert first.json()["results"][0]["status"] == "accepted"
    assert first.json()["results"][0]["verdict"] == "incorrect"
    # a second answer claiming to be earlier, sent after the first verdict was seen
    await sync(client, account, [record(catalog, item, exam["id"], now - timedelta(seconds=5))])
    done = (await post(client, account, f"/v1/assessment/exams/{exam['id']}/complete")).json()
    assert done["scores"][paper] == 0.0


async def test_starting_an_exam_twice_resumes_the_same_form(client: httpx.AsyncClient) -> None:
    account = await signed_up(client)
    first = (await post(client, account, "/v1/assessment/exams", {"level": "B1"})).json()
    again = (await post(client, account, "/v1/assessment/exams", {"level": "B1"})).json()
    assert again["id"] == first["id"]
    assert again["papers"] == first["papers"]
    assert again["ends_at"] == first["ends_at"]
    assert first["reused"] is False


async def test_answers_received_after_the_exam_ends_do_not_count(
    client: httpx.AsyncClient, catalog: ContentCatalog, database: Database
) -> None:
    account = await signed_up(client)
    exam = (await post(client, account, "/v1/assessment/exams", {"level": "A1"})).json()
    conn = await database.connect()
    try:
        await conn.execute(
            "UPDATE level_exams SET ends_at = created_at WHERE id = $1", uuid.UUID(exam["id"])
        )
    finally:
        await conn.close()
    items = [i for ids in exam["papers"].values() for i in ids]
    at = datetime.now(UTC)
    await sync(client, account, [record(catalog, i, exam["id"], at) for i in items])
    done = (await post(client, account, f"/v1/assessment/exams/{exam['id']}/complete")).json()
    assert done["passed"] is False
    assert set(done["scores"].values()) == {0.0}


async def test_a_borderline_certifying_score_waits_for_its_human_audit(
    rated_app: tuple[httpx.AsyncClient, FakeRater], database: Database
) -> None:
    """A B1 writing scored exactly at the band is borderline: it must not certify on its own,
    and a human score — the audit — then decides, in either direction."""
    client, _ = rated_app
    for level in ("B1",):
        await _calibrate(database, 0.9, level)
    account = await signed_up(client)
    rated_app[1].band = 3.0
    ids = []
    for task in ("w.B1.1", "w.B1.2"):
        body = (
            await post(
                client, account, "/v1/assessment/writing", {"task_id": task, "text": TEXT + task}
            )
        ).json()
        assert body["score"]["borderline"] is True
        assert body["score"]["certifying"] is True
        ids.append(body)
    prod = await _production_condition(client, account)
    assert "needs a certifying rater" in prod["shortfall"]

    conn = await database.connect()
    try:
        for body, band in zip(ids, (3.0, 2.0), strict=True):
            await conn.execute(
                "INSERT INTO rubric_scores (learner_id, id, submission_id, level, kind, rater_kind, "
                "rater_version, prompt_version, criteria, overall, certifying, borderline, created_at) "
                "VALUES ($1, $2, $3, 'B1', 'writing', 'human', 'rater:anna', NULL, "
                '\'{"lexis": {"band": 3, "evidence": ["x"]}}\'::jsonb, $4, true, false, now())',
                uuid.UUID(account.learner_id),
                uuid.uuid4(),
                uuid.UUID(body["submission_id"]),
                band,
            )
    finally:
        await conn.close()
    prod = await _production_condition(client, account)
    # the human put one task at band 2: the weakest task counts, and the machine 3.0 cannot win
    assert "rated band 2 of 3" in prod["shortfall"]


async def _production_condition(client: httpx.AsyncClient, account: Account) -> dict[str, Any]:
    r = await client.get("/v1/progress/level/B1", headers=bearer(account.access_token))
    assert r.status_code == 200, r.text
    production: dict[str, Any] = next(
        c for c in r.json()["conditions"] if c["name"] == "production"
    )
    return production


# ------------------------------------------------------------------- the report (docs/12 §9.2)


async def test_the_exam_report_explains_every_number_and_invents_none(
    client: httpx.AsyncClient, catalog: ContentCatalog
) -> None:
    account = await signed_up(client)
    exam = (await post(client, account, "/v1/assessment/exams", {"level": "A1"})).json()
    early = await client.get(
        f"/v1/assessment/exams/{exam['id']}/report", headers=bearer(account.access_token)
    )
    assert early.status_code == 409
    assert early.json()["reason"] == "incomplete"

    # every reading item right, every use-of-English item wrong where it can be, no listening
    at = datetime.now(UTC) - timedelta(minutes=20)
    reading = exam["papers"]["reading"]
    language = [
        i
        for i in exam["papers"]["use_of_english"]
        if correct_submission(catalog.items[i]) is not None
    ]
    records = [record(catalog, i, exam["id"], at) for i in reading]
    records += [record(catalog, i, exam["id"], at, right=False) for i in language]
    await sync(client, account, records)
    done = (await post(client, account, f"/v1/assessment/exams/{exam['id']}/complete")).json()
    assert done["passed"] is False

    r = await client.get(
        f"/v1/assessment/exams/{exam['id']}/report", headers=bearer(account.access_token)
    )
    assert r.status_code == 200, r.text
    report = r.json()
    assert report["overall"] == pytest.approx(done["overall"], abs=1e-4)
    assert report["note"] == "An internal assessment, not an accredited qualification."
    papers = {p["paper"]: p for p in report["papers"]}
    assert papers["reading"]["band"] == "secure"
    assert papers["reading"]["score"] == 1.0
    assert papers["reading"]["median_seconds"] == 5.0
    assert papers["listening"]["answered"] == 0
    assert papers["listening"]["band"] == "below"
    assert papers["listening"]["median_seconds"] is None
    assert papers["use_of_english"]["band"] == "below"

    skills = {s["skill"]: s for s in report["skills"]}
    assert skills["reading"]["value"] == 1.0
    assert skills["writing"]["value"] is None, "not assessed is not zero"
    assert skills["speaking"]["value"] is None
    assert (skills["writing"]["target"], skills["writing"]["scale"]) == (1, "band")

    assert report["error_norms"] is None
    kinds = {e["kind"]: e for e in report["error_types"]}
    assert sum(e["wrong"] for e in kinds.values()) >= 1
    assert all(e["wrong"] <= e["asked"] for e in kinds.values())

    assert 1 <= len(report["work_on"]) <= 5
    for w in report["work_on"]:
        assert w["wrong"] >= 1
        assert w["label"], w
        assert w["unit_id"] in catalog.units
    wrongs = [w["wrong"] for w in report["work_on"]]
    assert wrongs == sorted(wrongs, reverse=True)

    assert report["vocabulary"]["level_total"] > 0
    assert report["fluency"] == {
        "reading_target_wpm": "55–75",
        "speech_target_wpm": "50–65",
        "speech_rate_wpm": None,
    }
    timeline = report["timeline"]
    assert timeline["next_level"] == "A2"
    assert timeline["units_left"] > 0
    assert (timeline["weeks"], timeline["reason"]) == (None, "no_pace"), "no units done yet"

    other = await signed_up(client)
    hidden = await client.get(
        f"/v1/assessment/exams/{exam['id']}/report", headers=bearer(other.access_token)
    )
    assert hidden.status_code == 404
