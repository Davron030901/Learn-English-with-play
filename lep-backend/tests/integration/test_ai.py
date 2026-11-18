"""The AI conversation partner, end to end, with a fake model in place of the provider."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from app.ai.partner import Exchange, ModelTurn, ModelUnavailable, PartnerTurn, Recast
from app.config import Settings
from app.models.ai import AiConversation, AiTurn
from app.services.ai import AiService, _Loaded
from app.services.gamification import GamificationService
from app.workers.tasks import purge_expired_ai_conversations_async
from tests.factories import OffsetClock
from tests.integration.api import Account, bearer, signed_up
from tests.integration.conftest import Database, start_app, worker_settings_for

pytestmark = pytest.mark.integration

UNIT = "S01U01"


@dataclass
class Call:
    system: str
    history: list[Exchange]
    note: str | None


@dataclass
class FakeModel:
    """Scripted replies; records every call it gets."""

    replies: list[PartnerTurn | Exception] = field(default_factory=list)
    calls: list[Call] = field(default_factory=list)

    async def respond(
        self, *, system: str, history: Sequence[Exchange], note: str | None = None
    ) -> ModelTurn:
        self.calls.append(Call(system, list(history), note))
        nxt = self.replies.pop(0) if self.replies else turn("Nice to meet you. How are you?")
        if isinstance(nxt, Exception):
            raise nxt
        return ModelTurn(nxt, input_tokens=100, output_tokens=20)


def turn(
    reply: str, *, recasts: list[Recast] | None = None, met: list[str] | None = None
) -> PartnerTurn:
    return PartnerTurn(reply=reply, recasts=recasts or [], subgoals_met=met or [], off_limits=False)


@dataclass
class Harness:
    client: httpx.AsyncClient
    model: FakeModel | None
    account: Account
    app: FastAPI

    async def post(self, path: str, body: Any = None) -> httpx.Response:
        return await self.client.post(path, json=body, headers=bearer(self.account.access_token))

    async def get(self, path: str) -> httpx.Response:
        return await self.client.get(path, headers=bearer(self.account.access_token))

    async def start(self, mode: str = "accuracy") -> dict[str, Any]:
        cast = await self.get(f"/v1/ai/characters?unit_id={UNIT}")
        assert cast.status_code == 200, cast.text
        character = cast.json()["characters"][0]["id"]
        r = await self.post(
            "/v1/ai/conversations", {"character_id": character, "unit_id": UNIT, "mode": mode}
        )
        assert r.status_code == 201, r.text
        body: dict[str, Any] = r.json()
        return body

    async def say(self, conversation: str, text: str, cid: str | None = None) -> httpx.Response:
        return await self.post(
            f"/v1/ai/conversations/{conversation}/turns",
            {"client_uuid": cid or str(uuid.uuid4()), "text": text, "rt_ms": 8000},
        )


async def _harness(
    settings: Settings, model: FakeModel | None, **overrides: Any
) -> AsyncIterator[Harness]:
    s = settings.model_copy(update=overrides) if overrides else settings
    async with start_app(s, clock=OffsetClock()) as running:
        running.app.state.container.ai = model
        account = await signed_up(running.client)
        yield Harness(running.client, model, account, running.app)


@pytest.fixture
async def partner(settings: Settings) -> AsyncIterator[Harness]:
    async for h in _harness(settings, FakeModel()):
        yield h


async def test_without_a_key_the_partner_reports_unavailable_and_refuses(
    settings: Settings,
) -> None:
    async for h in _harness(settings, None):
        status = await h.get("/v1/ai/status")
        assert status.status_code == 200
        assert status.json()["available"] is False
        r = await h.post(
            "/v1/ai/conversations", {"character_id": "sarah", "unit_id": UNIT, "mode": "fluency"}
        )
        assert r.status_code == 503
        assert r.json()["type"].endswith("ai_unavailable")


async def test_a_conversation_opens_answers_and_summarises(partner: Harness) -> None:
    assert partner.model is not None
    started = await partner.start()
    assert started["opening_line"]
    assert started["subgoals"], "the scenario's goals come from the unit's can-do statements"
    goal = started["subgoals"][0]["id"]
    assert "AI character, not a real person" in partner.model.calls[0].system

    partner.model.replies.append(
        turn(
            "Oh, you are from Tashkent? Me too!",
            recasts=[Recast(original="I from Tashkent", corrected="you are from Tashkent")],
            met=[goal],
        )
    )
    r = await partner.say(started["id"], "Hello, I from Tashkent")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["turn"] == 1
    assert body["subgoals_met"] == [goal]
    # accuracy mode shows the recast, underlined where it sits in the reply
    (recast,) = body["recasts"]
    assert recast["corrected"] == "you are from Tashkent"
    assert body["reply"][recast["start"] : recast["end"]].lower() == "you are from tashkent"
    assert body["awards"]["xp"] >= 3

    summary = await partner.post(f"/v1/ai/conversations/{started['id']}/end")
    assert summary.status_code == 200, summary.text
    s = summary.json()
    assert s["turns"] == 1
    assert s["focus_items"] == [
        {"original": "I from Tashkent", "corrected": "you are from Tashkent"}
    ]
    # ending twice returns the same summary; saying more is refused
    assert (await partner.post(f"/v1/ai/conversations/{started['id']}/end")).json() == s
    late = await partner.say(started["id"], "One more thing")
    assert late.status_code == 409

    transcript = await partner.get(f"/v1/ai/conversations/{started['id']}")
    assert [m["role"] for m in transcript.json()["messages"]] == [
        "character",
        "learner",
        "character",
    ]


async def test_fluency_mode_keeps_corrections_for_the_end(partner: Harness) -> None:
    assert partner.model is not None
    started = await partner.start(mode="fluency")
    liked = turn(
        "Great! What do you like?", recasts=[Recast(original="I likes", corrected="I like")]
    )
    # the same line twice: the level check may ask once more for a simpler reply
    partner.model.replies += [liked, liked]
    body = (await partner.say(started["id"], "I likes tea very much")).json()
    assert body["recasts"] == []
    summary = (await partner.post(f"/v1/ai/conversations/{started['id']}/end")).json()
    assert summary["focus_items"] == [{"original": "I likes", "corrected": "I like"}]


async def test_a_retried_turn_is_answered_once(partner: Harness) -> None:
    assert partner.model is not None
    started = await partner.start()
    cid = str(uuid.uuid4())
    first = await partner.say(started["id"], "Hello, my name is Ali", cid)
    calls = len(partner.model.calls)
    again = await partner.say(started["id"], "Hello, my name is Ali", cid)
    assert again.status_code == 200
    assert again.json()["reply"] == first.json()["reply"]
    assert again.json()["turn"] == 1
    assert len(partner.model.calls) == calls, "a retry after success never asks the model again"


async def test_a_turn_that_failed_upstream_is_resumed_by_its_retry(partner: Harness) -> None:
    assert partner.model is not None
    started = await partner.start()
    cid = str(uuid.uuid4())
    partner.model.replies.append(ModelUnavailable("overloaded"))
    failed = await partner.say(started["id"], "Hello there my friend", cid)
    assert failed.status_code == 503
    retried = await partner.say(started["id"], "Hello there my friend", cid)
    assert retried.status_code == 200, retried.text
    assert retried.json()["turn"] == 1
    messages = (await partner.get(f"/v1/ai/conversations/{started['id']}")).json()["messages"]
    assert [m["role"] for m in messages].count("learner") == 1


async def test_contact_details_never_reach_the_model_or_the_transcript(partner: Harness) -> None:
    assert partner.model is not None
    started = await partner.start()
    await partner.say(started["id"], "Write to me at ali@example.com or +998 90 123 45 67")
    sent = partner.model.calls[-1].history[-1].text
    assert "ali@example.com" not in sent
    assert "123 45 67" not in sent
    assert "[email]" in sent
    assert "[number]" in sent
    stored = (await partner.get(f"/v1/ai/conversations/{started['id']}")).json()["messages"]
    assert all("ali@example.com" not in m["text"] for m in stored)


async def test_a_reply_above_the_learners_level_is_regenerated_once(partner: Harness) -> None:
    assert partner.model is not None
    started = await partner.start()
    hard = (
        "Notwithstanding the considerable bureaucratic intricacies, I would recommend "
        "contemplating the municipal regulations extraordinarily carefully beforehand."
    )
    partner.model.replies += [turn(hard), turn("Hello! How are you today?")]
    body = (await partner.say(started["id"], "Hello, how are you")).json()
    assert body["reply"] == "Hello! How are you today?"
    retry = partner.model.calls[-1]
    assert retry.note is not None
    assert "too hard" in retry.note


async def test_a_refusal_is_replaced_by_a_safe_line(partner: Harness) -> None:
    assert partner.model is not None
    started = await partner.start()

    async def refuse(**_: Any) -> ModelTurn:
        return ModelTurn(turn(""), refused=True)

    partner.model.respond = refuse  # type: ignore[method-assign]
    cid = str(uuid.uuid4())
    body = (await partner.say(started["id"], "Tell me something off limits", cid)).json()
    assert body["off_limits"] is True
    assert body["reply"].startswith("Let's keep practising together.")
    # the flag is stored with the reply: a replay reports it too
    again = (await partner.say(started["id"], "Tell me something off limits", cid)).json()
    assert again["off_limits"] is True


async def test_an_off_limits_request_gets_the_safe_line_and_earns_nothing(
    partner: Harness,
) -> None:
    assert partner.model is not None
    started = await partner.start()
    goal = started["subgoals"][0]["id"]
    partner.model.replies.append(
        PartnerTurn(
            reply="Well, about dating, I think you should",
            recasts=[Recast(original="you has", corrected="you have")],
            subgoals_met=[goal],
            off_limits=True,
        )
    )
    body = (await partner.say(started["id"], "Do you have a boyfriend Sarah")).json()
    assert body["off_limits"] is True
    assert body["reply"].startswith("Let's keep practising together."), "never the model's text"
    assert body["recasts"] == []
    assert body["subgoals_met"] == []
    summary = (await partner.post(f"/v1/ai/conversations/{started['id']}/end")).json()
    assert summary["xp"] == 0


async def test_the_opening_line_is_cleaned_and_never_empty(settings: Settings) -> None:
    linky = turn("Hi! See www.tashkent-cafe.uz or t.me/cafe. What do you want?")
    # twice: the level check may ask once more
    async for h in _harness(settings, FakeModel(replies=[linky, linky])):
        opening = (await h.start())["opening_line"]
        assert "tashkent-cafe" not in opening
        assert "t.me" not in opening
        assert "[link]" in opening
    async for h in _harness(settings, FakeModel(replies=[turn("   "), turn("   ")])):
        assert (await h.start())["opening_line"].startswith("Let's keep practising together.")


async def test_any_failure_to_open_refunds_the_allowance(settings: Settings) -> None:
    """A rejected request (credit exhausted, revoked key, retired model) is not a 503, but it
    still gives the conversation back."""
    model = FakeModel(replies=[RuntimeError("credit balance too low")])
    async for h in _harness(settings, model, ai_daily_conversations=1):
        cast = (await h.get(f"/v1/ai/characters?unit_id={UNIT}")).json()["characters"]
        body = {"character_id": cast[0]["id"], "unit_id": UNIT, "mode": "accuracy"}
        try:
            failed = await h.post("/v1/ai/conversations", body)
            assert failed.status_code == 500
        except RuntimeError:
            pass  # the test transport re-raises what the app did not handle
        assert (await h.get("/v1/ai/status")).json()["used_today"] == 0
        assert (await h.post("/v1/ai/conversations", body)).status_code == 201


@dataclass
class GatedModel(FakeModel):
    """Holds every learner-turn reply until ``gate`` opens (the opening line passes)."""

    gate: asyncio.Event = field(default_factory=asyncio.Event)
    entered: asyncio.Event = field(default_factory=asyncio.Event)

    async def respond(
        self, *, system: str, history: Sequence[Exchange], note: str | None = None
    ) -> ModelTurn:
        if history:
            self.entered.set()
            await self.gate.wait()
        return await super().respond(system=system, history=history, note=note)


async def test_while_a_reply_is_being_written_nothing_else_asks_the_model(
    settings: Settings,
) -> None:
    model = GatedModel()
    async for h in _harness(settings, model):
        started = await h.start()
        cid = str(uuid.uuid4())
        first = asyncio.create_task(h.say(started["id"], "Hello, my name is Ali", cid))
        await asyncio.wait_for(model.entered.wait(), 10)
        # the same message again, a new message, and ending the chat all wait their turn
        duplicate = await h.say(started["id"], "Hello, my name is Ali", cid)
        assert duplicate.status_code == 409, duplicate.text
        assert duplicate.json()["type"].endswith("ai_busy")
        assert (await h.say(started["id"], "And another thing")).status_code == 409
        assert (await h.post(f"/v1/ai/conversations/{started['id']}/end")).status_code == 409
        model.gate.set()
        answered = await first
        assert answered.status_code == 200, answered.text
        assert sum(1 for c in model.calls if c.history) == 1, "the model was asked once"
        assert (await h.say(started["id"], "Hello, my name is Ali", cid)).json()["turn"] == 1


async def test_an_unanswered_message_is_replaced_by_the_next_one(partner: Harness) -> None:
    assert partner.model is not None
    started = await partner.start()
    partner.model.replies.append(ModelUnavailable("overloaded"))
    lost = await partner.say(started["id"], "Hello there my friend")
    assert lost.status_code == 503
    r = await partner.say(started["id"], "I am Ali from Tashkent")
    assert r.status_code == 200, r.text
    assert r.json()["turn"] == 1
    assert partner.model.calls[-1].history[-1].text == "I am Ali from Tashkent"
    messages = (await partner.get(f"/v1/ai/conversations/{started['id']}")).json()["messages"]
    assert [m["role"] for m in messages] == ["character", "learner", "character"]
    assert messages[1]["text"] == "I am Ali from Tashkent"


async def test_a_unit_the_learner_has_not_reached_is_not_offered(partner: Harness) -> None:
    far = "S02U11"  # Mr Karimov's first episode
    r = await partner.post(
        "/v1/ai/conversations", {"character_id": "karimov", "unit_id": far, "mode": "fluency"}
    )
    assert r.status_code == 404
    cast = (await partner.get(f"/v1/ai/characters?unit_id={far}")).json()
    assert "karimov" not in {c["id"] for c in cast["characters"]}
    assert {s["unit_id"] for s in cast["scenarios"]} == {UNIT}


async def test_the_daily_allowance_is_uniform_and_refunded_when_nothing_happened(
    settings: Settings,
) -> None:
    model = FakeModel(replies=[ModelUnavailable("down")])
    async for h in _harness(settings, model, ai_daily_conversations=1):
        cast = (await h.get(f"/v1/ai/characters?unit_id={UNIT}")).json()["characters"]
        body = {"character_id": cast[0]["id"], "unit_id": UNIT, "mode": "accuracy"}
        down = await h.post("/v1/ai/conversations", body)
        assert down.status_code == 503
        assert (await h.get("/v1/ai/status")).json()["used_today"] == 0
        assert (await h.post("/v1/ai/conversations", body)).status_code == 201
        over = await h.post("/v1/ai/conversations", body)
        assert over.status_code == 409
        assert over.json()["type"].endswith("ai_allowance")


async def test_the_last_turn_ends_the_conversation(settings: Settings) -> None:
    async for h in _harness(settings, FakeModel(), ai_max_turns=2):
        started = await h.start()
        assert (await h.say(started["id"], "Hello, how are you")).json()["ended"] is False
        assert (await h.say(started["id"], "I am fine, thank you")).json()["ended"] is True
        assert (await h.say(started["id"], "And one more")).status_code == 409


async def test_characters_are_only_those_already_met(partner: Harness) -> None:
    cast = await partner.get(f"/v1/ai/characters?unit_id={UNIT}")
    met = {c["id"] for c in cast.json()["characters"]}
    assert met
    assert all(c["ai"] is True for c in cast.json()["characters"])
    unknown = await partner.post(
        "/v1/ai/conversations", {"character_id": "nobody", "unit_id": UNIT, "mode": "fluency"}
    )
    assert unknown.status_code == 404


async def test_a_learner_cannot_read_another_learners_conversation(partner: Harness) -> None:
    started = await partner.start()
    other = await signed_up(partner.client)
    r = await partner.client.get(
        f"/v1/ai/conversations/{started['id']}", headers=bearer(other.access_token)
    )
    assert r.status_code == 404


async def test_deleting_and_purging_remove_transcripts(
    partner: Harness, database: Database
) -> None:
    kept = await partner.start()
    deleted = await partner.start()
    assert (
        await partner.client.delete(
            f"/v1/ai/conversations/{deleted['id']}",
            headers=bearer(partner.account.access_token),
        )
    ).status_code == 204
    assert (await partner.get(f"/v1/ai/conversations/{deleted['id']}")).status_code == 404

    worker = worker_settings_for(database)
    nothing = await purge_expired_ai_conversations_async(worker)
    assert nothing["conversations"] == 0
    later = datetime.now(UTC) + timedelta(days=31)
    purged = await purge_expired_ai_conversations_async(worker, now=later)
    assert purged["conversations"] == 1
    assert purged["turns"] >= 1
    assert (await partner.get(f"/v1/ai/conversations/{kept['id']}")).status_code == 404


async def test_a_retried_start_returns_the_same_conversation_charged_once(
    partner: Harness,
) -> None:
    assert partner.model is not None
    body = {
        "character_id": "sarah",
        "unit_id": UNIT,
        "mode": "accuracy",
        "client_uuid": str(uuid.uuid4()),
    }
    first = await partner.post("/v1/ai/conversations", body)
    assert first.status_code == 201, first.text
    calls = len(partner.model.calls)
    again = await partner.post("/v1/ai/conversations", body)
    assert again.status_code == 201, again.text
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["opening_line"] == first.json()["opening_line"]
    assert len(partner.model.calls) == calls, "the opening line is not asked for twice"
    assert (await partner.get("/v1/ai/status")).json()["used_today"] == 1


async def test_a_reply_that_could_not_be_stored_gives_its_lease_back(
    partner: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A database error after the model answered must not leave the turn busy for minutes."""
    started = await partner.start()
    original = GamificationService.credit_activity
    failures = [RuntimeError("the database went away")]

    async def flaky(self: GamificationService, *args: Any, **kwargs: Any) -> Any:
        if failures:
            raise failures.pop()
        return await original(self, *args, **kwargs)

    monkeypatch.setattr(GamificationService, "credit_activity", flaky)
    cid = str(uuid.uuid4())
    try:
        failed = await partner.say(started["id"], "Hello, my name is Ali", cid)
        assert failed.status_code == 500
    except RuntimeError:
        pass  # the test transport re-raises what the app did not handle
    retried = await partner.say(started["id"], "Hello, my name is Ali", cid)
    assert retried.status_code == 200, retried.text
    assert retried.json()["turn"] == 1


async def test_a_request_gives_back_only_its_own_lease(partner: Harness) -> None:
    """A request that outlived its lease must not clear the lease a newer request holds."""
    assert partner.model is not None
    started = await partner.start()
    cid = uuid.uuid4()
    partner.model.replies.append(ModelUnavailable("overloaded"))
    assert (await partner.say(started["id"], "Hello there my friend", str(cid))).status_code == 503
    container = partner.app.state.container
    service = AiService(
        container.sessionmaker,
        container.content,
        container.clock,
        container.settings,
        partner.model,
    )
    learner = uuid.UUID(partner.account.learner_id)
    conversation = uuid.UUID(started["id"])
    newer = datetime.now(UTC) + timedelta(minutes=3)
    async with container.sessionmaker() as session, session.begin():
        turn_row = await session.get(AiTurn, (learner, conversation, 1))
        assert turn_row is not None
        turn_row.answering_until = newer  # a newer request's lease
        row = await session.get(AiConversation, (learner, conversation))
        assert row is not None
    stale = _Loaded(row, [], 1, None, newer - timedelta(minutes=5))
    await service._release(learner, conversation, stale, cid)
    async with container.sessionmaker() as session, session.begin():
        kept = await session.get(AiTurn, (learner, conversation, 1))
        assert kept is not None
        assert kept.answering_until == newer
    assert (await partner.say(started["id"], "Hello there my friend", str(cid))).status_code == 409
