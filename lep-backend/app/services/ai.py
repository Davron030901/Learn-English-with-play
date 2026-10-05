"""The AI conversation partner (docs/16 E21; backend brief Phase 8).

A conversation is a scenario from a unit the learner has reached, with a character they have
met. Each learner turn is stored before the model is asked, and the model's reply after — the
call happens between two short transactions, so no database connection waits on the network.
A turn is idempotent by its ``client_uuid``: a retry after a failure resumes the same turn,
and a retry after success returns the stored reply.

The character's English is held to the learner's level (``app.domain.conversation``): a reply
that is too long or uses too many words beyond the course so far is regenerated once with a
note to simplify. Contact details are redacted before anything is stored or sent.

The allowance (conversations and tokens per learner-local day) is published and uniform; it
cannot be raised with gems or money (docs/16 E21, "considered and rejected").
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.partner import (
    ConversationModel,
    Exchange,
    ModelTurn,
    ModelUnavailable,
    Scenario,
    system_prompt,
)
from app.clock import Clock
from app.config import Settings
from app.content.catalog import ContentCatalog
from app.domain import conversation as cv
from app.domain.age_policy import is_minor
from app.domain.streaks import local_day
from app.ids import uuid7
from app.models.ai import AiConversation, AiTurn, AiUsageDaily
from app.observability.logs import get_logger
from app.repositories.learners import LearnerRepository, Profile
from app.repositories.reviews import ReviewRepository
from app.services.gamification import Awards, GamificationService

_log = get_logger("app.ai")

#: the reply shown when the model declines or steps outside the rules
SAFE_REPLY = "Let's keep practising together. {question}"
STORY_EPISODES = 3
STORY_LINES = 10


class AiError(Exception):
    """A request the partner cannot serve; ``kind`` picks the problem type."""

    def __init__(self, kind: str, detail: str) -> None:
        super().__init__(detail)
        self.kind = kind


@dataclass(frozen=True, slots=True)
class Status:
    available: bool
    daily_limit: int
    used_today: int
    max_turns: int
    retention_days: int


@dataclass(frozen=True, slots=True)
class CharacterView:
    id: str
    name: str
    role: dict[str, str]
    first_unit: str


@dataclass(frozen=True, slots=True)
class ScenarioView:
    unit_id: str
    cefr: str
    title: dict[str, str]
    can_do: list[str]
    characters: list[str]


@dataclass(frozen=True, slots=True)
class RecastView:
    original: str
    corrected: str
    start: int | None
    end: int | None


@dataclass(slots=True)
class TurnResult:
    reply: str
    recasts: list[RecastView]
    subgoals_met: list[str]
    turn: int
    max_turns: int
    ended: bool
    goal_met: bool
    off_limits: bool
    awards: Awards = field(default_factory=Awards)


@dataclass(frozen=True, slots=True)
class Started:
    id: UUID
    character_id: str
    unit_id: str
    mode: str
    opening_line: str
    subgoals: list[cv.Subgoal]
    starters: list[str]
    max_turns: int
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class Summary:
    goal_met: bool
    subgoals_met: list[str]
    focus_items: list[dict[str, str]]
    words_used: list[str]
    xp: int
    turns: int


@dataclass(frozen=True, slots=True)
class Transcript:
    id: UUID
    character_id: str
    unit_id: str
    mode: str
    status: str
    subgoals: list[dict[str, str]]
    met: list[str]
    turns: int
    created_at: datetime
    expires_at: datetime
    messages: list[dict[str, Any]]
    summary: dict[str, Any] | None


@dataclass(frozen=True, slots=True)
class _Loaded:
    row: AiConversation
    history: list[Exchange]
    learner_seq: int
    reply: AiTurn | None


_CAST_INDEX: dict[str, tuple[list[str], dict[str, str]]] = {}


def _cast_index(catalog: ContentCatalog) -> tuple[list[str], dict[str, str]]:
    """Course order and each character's first episode, computed once per content version."""
    hit = _CAST_INDEX.get(catalog.version)
    if hit is None:
        order = list(catalog.unit_order())
        stories = {
            u: [line.get("speaker", "") for line in catalog.units[u].story.get("body", [])]
            for u in order
        }
        hit = (order, cv.first_appearances(order, stories))
        _CAST_INDEX[catalog.version] = hit
    return hit


class AiService:
    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        catalog: ContentCatalog,
        clock: Clock,
        settings: Settings,
        model: ConversationModel | None,
    ) -> None:
        self._sessions = sessionmaker
        self._catalog = catalog
        self._clock = clock
        self._settings = settings
        self._model = model
        self._order, self._firsts = _cast_index(catalog)

    # ------------------------------------------------------------------- reads

    async def status(self, learner_id: UUID) -> Status:
        async with self._sessions() as session, session.begin():
            profile = await self._profile(session, learner_id)
            used = await self._usage(session, learner_id, self._today(profile))
        return Status(
            available=self._model is not None,
            daily_limit=self._settings.ai_daily_conversations,
            used_today=used.conversations if used else 0,
            max_turns=self._settings.ai_max_turns,
            retention_days=self._settings.ai_retention_days,
        )

    def characters(self, unit_id: str) -> tuple[list[CharacterView], list[ScenarioView]]:
        if unit_id not in self._catalog.units:
            raise AiError("not_found", "there is no such unit")
        met = cv.available_cast(unit_id, self._order, self._firsts)
        cast = [
            CharacterView(p.id, p.name, dict(p.role), self._firsts[p.id])
            for p in cv.CAST
            if p.id in met
        ]
        here = self._order.index(unit_id)
        scenarios = []
        for u in reversed(self._order[max(0, here - 2) : here + 1]):
            unit = self._catalog.units[u]
            scenarios.append(
                ScenarioView(
                    u,
                    unit.cefr,
                    dict(unit.title),
                    list(unit.can_do),
                    cv.available_cast(u, self._order, self._firsts),
                )
            )
        return cast, scenarios

    async def transcript(self, learner_id: UUID, conversation_id: UUID) -> Transcript:
        async with self._sessions() as session, session.begin():
            row = await session.get(AiConversation, (learner_id, conversation_id))
            if row is None:
                raise AiError("not_found", "there is no such conversation")
            turns = (
                await session.execute(
                    select(AiTurn)
                    .where(AiTurn.learner_id == learner_id, AiTurn.conversation_id == row.id)
                    .order_by(AiTurn.seq)
                )
            ).scalars()
            messages = [
                {
                    "seq": t.seq,
                    "role": t.role,
                    "text": t.text,
                    "recasts": t.recasts,
                    "at": t.created_at,
                }
                for t in turns
            ]
            return Transcript(
                row.id,
                row.character_id,
                row.unit_id,
                row.mode,
                row.status,
                row.subgoals,
                row.met,
                row.turns,
                row.created_at,
                row.expires_at,
                messages,
                row.summary,
            )

    # ------------------------------------------------------------------- start

    async def start(self, learner_id: UUID, character_id: str, unit_id: str, mode: str) -> Started:
        model = self._require_model()
        if mode not in cv.MODES:
            raise AiError("invalid", "mode must be fluency or accuracy")
        unit = self._catalog.units.get(unit_id)
        if unit is None:
            raise AiError("not_found", "there is no such unit")
        if character_id not in cv.available_cast(unit_id, self._order, self._firsts):
            raise AiError("not_found", "the learner has not met this character by this unit")
        now = self._clock.now()
        cid = uuid7()
        expires = now + timedelta(days=self._settings.ai_retention_days)
        subgoals = cv.subgoals_for(unit.can_do)
        # 1. reserve: the allowance is checked and counted under the learner's lock
        async with self._sessions() as session, session.begin():
            profile = await self._profile(session, learner_id)
            await ReviewRepository(session).lock_learner(learner_id)
            today = self._today(profile)
            await self._check_allowance(session, learner_id, today, starting=True)
            session.add(
                AiConversation(
                    learner_id=learner_id,
                    id=cid,
                    character_id=character_id,
                    unit_id=unit_id,
                    cefr=unit.cefr,
                    mode=mode,
                    subgoals=[{"id": g.id, "text": g.text} for g in subgoals],
                    met=[],
                    turns=0,
                    xp=0,
                    status="open",
                    prompt_version=cv.PROMPT_VERSION,
                    created_at=now,
                    ended_at=None,
                    expires_at=expires,
                    summary=None,
                )
            )
            await self._add_usage(session, learner_id, today, conversations=1)
        # 2. the opening line, outside any transaction
        scenario = self._scenario(profile, character_id, unit_id, mode, subgoals)
        try:
            opened = await self._ask(model, scenario, [])
        except ModelUnavailable:
            # nothing happened: give the conversation back
            async with self._sessions() as session, session.begin():
                await session.execute(
                    delete(AiConversation).where(
                        AiConversation.learner_id == learner_id, AiConversation.id == cid
                    )
                )
                await self._add_usage(session, learner_id, today, conversations=-1)
            raise AiError(
                "unavailable", "the conversation partner is not available right now"
            ) from None
        opening = opened.turn.reply if not opened.refused else self._safe_reply(subgoals)
        async with self._sessions() as session, session.begin():
            session.add(
                AiTurn(
                    learner_id=learner_id,
                    conversation_id=cid,
                    seq=0,
                    role="character",
                    text=opening,
                    recasts=[],
                    client_uuid=None,
                    created_at=self._clock.now(),
                    expires_at=expires,
                )
            )
            await self._add_usage(
                session,
                learner_id,
                today,
                input_tokens=opened.input_tokens,
                output_tokens=opened.output_tokens,
            )
        return Started(
            cid,
            character_id,
            unit_id,
            mode,
            opening,
            subgoals,
            self._starters(unit_id),
            self._settings.ai_max_turns,
            expires,
        )

    # ------------------------------------------------------------------- a turn

    async def turn(
        self,
        learner_id: UUID,
        conversation_id: UUID,
        client_uuid: UUID,
        text: str,
        rt_ms: int | None,
    ) -> TurnResult:
        model = self._require_model()
        said = cv.redact(text).strip()
        if not said:
            raise AiError("invalid", "say something first")
        # 1. store the learner's turn (or find it again on a retry)
        async with self._sessions() as session, session.begin():
            profile = await self._profile(session, learner_id)
            loaded = await self._load_for_turn(
                session, learner_id, conversation_id, client_uuid, said, profile
            )
        row = loaded.row
        if loaded.reply is not None:
            return self._result(row, loaded.reply, refused=False)
        subgoals = [cv.Subgoal(g["id"], g["text"]) for g in row.subgoals]
        scenario = self._scenario(profile, row.character_id, row.unit_id, row.mode, subgoals)
        # 2. ask the model, outside any transaction
        try:
            answered = await self._ask(model, scenario, loaded.history)
        except ModelUnavailable:
            raise AiError(
                "unavailable", "the conversation partner is not available right now; try again"
            ) from None
        reply_text = (
            cv.clean_reply(answered.turn.reply)
            if not answered.refused and cv.clean_reply(answered.turn.reply)
            else self._safe_reply(subgoals)
        )
        recasts = [
            {"original": r.original.strip(), "corrected": r.corrected.strip()}
            for r in answered.turn.recasts[:2]
            if r.corrected.strip() and r.corrected.strip() != r.original.strip()
        ]
        valid = {g.id for g in subgoals}
        newly_met = [g for g in answered.turn.subgoals_met if g in valid]
        # 3. store the reply and credit the turn, once
        async with self._sessions() as session, session.begin():
            now = self._clock.now()
            inserted = await session.execute(
                insert(AiTurn)
                .values(
                    learner_id=learner_id,
                    conversation_id=conversation_id,
                    seq=loaded.learner_seq + 1,
                    role="character",
                    text=reply_text,
                    recasts=recasts,
                    client_uuid=None,
                    created_at=now,
                    expires_at=row.expires_at,
                )
                .on_conflict_do_nothing(index_elements=["learner_id", "conversation_id", "seq"])
                .returning(AiTurn.seq)
            )
            if inserted.first() is None:
                # a parallel retry stored the reply first: return that one
                stored = await session.get(
                    AiTurn, (learner_id, conversation_id, loaded.learner_seq + 1)
                )
                fresh = await session.get(
                    AiConversation, (learner_id, conversation_id), populate_existing=True
                )
                if stored is None or fresh is None:
                    raise AiError("not_found", "there is no such conversation")
                return self._result(fresh, stored, refused=False)
            conv = await session.get(
                AiConversation,
                (learner_id, conversation_id),
                with_for_update=True,
                populate_existing=True,
            )
            if conv is None:
                raise AiError("not_found", "there is no such conversation")
            conv.met = sorted(set(conv.met) | set(newly_met))
            xp = cv.turn_xp(said)
            conv.xp += xp
            await self._add_usage(
                session,
                learner_id,
                self._today(profile),
                input_tokens=answered.input_tokens,
                output_tokens=answered.output_tokens,
            )
            awards = await GamificationService(session, self._catalog, self._clock).credit_activity(
                learner_id,
                profile,
                at=now,
                active_ms=cv.turn_active_ms(rt_ms, said),
                xp=xp,
                source="conversation",
                session_id=conversation_id,
            )
            stored = AiTurn(
                learner_id=learner_id,
                conversation_id=conversation_id,
                seq=loaded.learner_seq + 1,
                role="character",
                text=reply_text,
                recasts=recasts,
                client_uuid=None,
                created_at=now,
                expires_at=row.expires_at,
            )
            result = self._result(
                conv, stored, refused=answered.refused or answered.turn.off_limits
            )
        result.awards = awards
        return result

    # ------------------------------------------------------------------- end, delete, purge

    async def end(self, learner_id: UUID, conversation_id: UUID) -> Summary:
        async with self._sessions() as session, session.begin():
            row = await session.get(
                AiConversation, (learner_id, conversation_id), with_for_update=True
            )
            if row is None:
                raise AiError("not_found", "there is no such conversation")
            if row.status == "ended" and row.summary is not None:
                return Summary(**row.summary)
            turns = list(
                (
                    await session.execute(
                        select(AiTurn)
                        .where(
                            AiTurn.learner_id == learner_id,
                            AiTurn.conversation_id == conversation_id,
                        )
                        .order_by(AiTurn.seq)
                    )
                ).scalars()
            )
            learner_texts = [t.text for t in turns if t.role == "learner"]
            recasts = [r for t in turns if t.role == "character" for r in t.recasts]
            unit = self._catalog.units[row.unit_id]
            lemmas = [self._catalog.lexemes[i].lemma for i in unit.lexeme_ids]
            summary = Summary(
                goal_met=bool(row.subgoals) and {g["id"] for g in row.subgoals} <= set(row.met),
                subgoals_met=list(row.met),
                focus_items=cv.focus_items(recasts),
                words_used=cv.words_used(learner_texts, lemmas),
                xp=row.xp,
                turns=row.turns,
            )
            row.status = "ended"
            row.ended_at = self._clock.now()
            row.summary = {
                "goal_met": summary.goal_met,
                "subgoals_met": summary.subgoals_met,
                "focus_items": summary.focus_items,
                "words_used": summary.words_used,
                "xp": summary.xp,
                "turns": summary.turns,
            }
            return summary

    async def delete(self, learner_id: UUID, conversation_id: UUID) -> None:
        async with self._sessions() as session, session.begin():
            gone = await session.execute(
                delete(AiConversation)
                .where(
                    AiConversation.learner_id == learner_id,
                    AiConversation.id == conversation_id,
                )
                .returning(AiConversation.id)
            )
            if gone.first() is None:
                raise AiError("not_found", "there is no such conversation")

    # ------------------------------------------------------------------- internals

    def _require_model(self) -> ConversationModel:
        if self._model is None:
            raise AiError("unavailable", "the conversation partner is not enabled on this server")
        return self._model

    async def _profile(self, session: AsyncSession, learner_id: UUID) -> Profile:
        profile = await LearnerRepository(session).profile(learner_id)
        if profile is None:
            raise AiError("gone", "this account no longer exists")
        return profile

    def _today(self, profile: Profile) -> date:
        return local_day(self._clock.now(), profile.tz)

    @staticmethod
    async def _usage(session: AsyncSession, learner_id: UUID, day: date) -> AiUsageDaily | None:
        return await session.get(AiUsageDaily, (learner_id, day), populate_existing=True)

    async def _check_allowance(
        self, session: AsyncSession, learner_id: UUID, day: date, *, starting: bool
    ) -> None:
        used = await self._usage(session, learner_id, day)
        if used is None:
            return
        if starting and used.conversations >= self._settings.ai_daily_conversations:
            raise AiError("allowance", "that is today's conversations")
        if used.input_tokens + used.output_tokens >= self._settings.ai_daily_token_budget:
            raise AiError("allowance", "that is today's conversation time")

    @staticmethod
    async def _add_usage(
        session: AsyncSession,
        learner_id: UUID,
        day: date,
        *,
        conversations: int = 0,
        turns: int = 0,
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> None:
        values = {
            "conversations": conversations,
            "turns": turns,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }
        stmt = insert(AiUsageDaily).values(
            learner_id=learner_id, day=day, **{k: max(0, v) for k, v in values.items()}
        )
        await session.execute(
            stmt.on_conflict_do_update(
                index_elements=[AiUsageDaily.learner_id, AiUsageDaily.day],
                set_={k: func.greatest(0, getattr(AiUsageDaily, k) + v) for k, v in values.items()},
            )
        )

    async def _load_for_turn(
        self,
        session: AsyncSession,
        learner_id: UUID,
        conversation_id: UUID,
        client_uuid: UUID,
        said: str,
        profile: Profile,
    ) -> _Loaded:
        row = await session.get(
            AiConversation,
            (learner_id, conversation_id),
            with_for_update=True,
            populate_existing=True,
        )
        if row is None:
            raise AiError("not_found", "there is no such conversation")
        existing = (
            await session.execute(
                select(AiTurn).where(
                    AiTurn.learner_id == learner_id,
                    AiTurn.conversation_id == conversation_id,
                    AiTurn.client_uuid == client_uuid,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            learner_seq = existing.seq
            reply = await session.get(AiTurn, (learner_id, conversation_id, learner_seq + 1))
            if reply is not None:
                return _Loaded(row, [], learner_seq, reply)
        else:
            if row.status != "open":
                raise AiError("ended", "this conversation has ended")
            if row.turns >= self._settings.ai_max_turns:
                raise AiError("ended", "this conversation has reached its last turn")
            await self._check_allowance(session, learner_id, self._today(profile), starting=False)
            learner_seq = 2 * row.turns + 1
            session.add(
                AiTurn(
                    learner_id=learner_id,
                    conversation_id=conversation_id,
                    seq=learner_seq,
                    role="learner",
                    text=said,
                    recasts=[],
                    client_uuid=client_uuid,
                    created_at=self._clock.now(),
                    expires_at=row.expires_at,
                )
            )
            row.turns += 1
            await self._add_usage(session, learner_id, self._today(profile), turns=1)
            await session.flush()
        history = [
            Exchange("learner" if t.role == "learner" else "character", t.text)
            for t in (
                await session.execute(
                    select(AiTurn)
                    .where(
                        AiTurn.learner_id == learner_id,
                        AiTurn.conversation_id == conversation_id,
                        AiTurn.seq <= learner_seq,
                    )
                    .order_by(AiTurn.seq)
                )
            ).scalars()
        ]
        return _Loaded(row, history, learner_seq, None)

    def _result(self, row: AiConversation, reply: AiTurn, *, refused: bool) -> TurnResult:
        shown = reply.recasts if row.mode == "accuracy" else []
        recasts = []
        for r in shown:
            span = cv.span_of(reply.text, r.get("corrected", ""))
            recasts.append(
                RecastView(
                    r.get("original", ""),
                    r.get("corrected", ""),
                    span[0] if span else None,
                    span[1] if span else None,
                )
            )
        turn = (reply.seq + 1) // 2 if reply.seq else 0
        ids = [g["id"] for g in row.subgoals]
        return TurnResult(
            reply=reply.text,
            recasts=recasts,
            subgoals_met=list(row.met),
            turn=turn,
            max_turns=self._settings.ai_max_turns,
            ended=row.status != "open" or turn >= self._settings.ai_max_turns,
            goal_met=bool(ids) and set(ids) <= set(row.met),
            off_limits=refused,
        )

    def _scenario(
        self,
        profile: Profile,
        character_id: str,
        unit_id: str,
        mode: str,
        subgoals: Sequence[cv.Subgoal],
    ) -> Scenario:
        unit = self._catalog.units[unit_id]
        persona = cv.BY_ID[character_id]
        return Scenario(
            persona=persona,
            unit_id=unit_id,
            unit_title=unit.title.get("en", unit_id),
            cefr=unit.cefr,
            can_do=list(unit.can_do),
            subgoals=list(subgoals),
            mode=mode,
            story_context=self._story_context(persona.name, unit_id),
            max_sentence_words=cv.MAX_SENTENCE_WORDS.get(cv.band(unit.cefr)),
            is_minor=is_minor(profile.birth_year, self._today(profile)),
            max_turns=self._settings.ai_max_turns,
            learner_l1={"uz": "Uzbek", "ru": "Russian"}.get(profile.l1, profile.l1),
        )

    def _story_context(self, speaker: str, unit_id: str) -> list[str]:
        """The latest episodes this character spoke in, up to the learner's unit (no spoilers)."""
        here = self._order.index(unit_id)
        out: list[str] = []
        episodes = 0
        for u in reversed(self._order[: here + 1]):
            story = self._catalog.units[u].story
            body = story.get("body", [])
            if not any(line.get("speaker") == speaker for line in body):
                continue
            lines = " / ".join(
                f"{line.get('speaker')}: {line.get('text')}" for line in body[:STORY_LINES]
            )
            out.append(f"Episode '{story.get('title', u)}': {lines}")
            episodes += 1
            if episodes == STORY_EPISODES:
                break
        return list(reversed(out))

    def _vocabulary(self, unit_id: str) -> frozenset[str]:
        here = self._order.index(unit_id)
        out: set[str] = set()
        for u in self._order[: here + 1]:
            for lexeme_id in self._catalog.units[u].lexeme_ids:
                lexeme = self._catalog.lexemes.get(lexeme_id)
                if lexeme is not None:
                    out.update(cv.words(lexeme.lemma))
        return frozenset(out)

    async def _ask(
        self, model: ConversationModel, scenario: Scenario, history: Sequence[Exchange]
    ) -> ModelTurn:
        """One reply, held to the learner's level: regenerate once with a note if it is not."""
        system = system_prompt(scenario)
        first = await model.respond(system=system, history=history)
        if first.refused:
            return first
        vocabulary = self._vocabulary(scenario.unit_id)
        check = cv.check_level(first.turn.reply, scenario.cefr, vocabulary)
        if check.ok:
            return first
        note = (
            "Your last reply was too hard for this learner"
            + (
                f" (a sentence had {check.longest_sentence} words)"
                if scenario.max_sentence_words
                and check.longest_sentence > scenario.max_sentence_words
                else ""
            )
            + (f"; avoid these words: {', '.join(check.unknown[:12])}" if check.unknown else "")
            + ". Say the same thing again with shorter sentences and only very common words."
        )
        second = await model.respond(system=system, history=history, note=note)
        _log.info(
            "ai_level_retry",
            coverage=round(check.coverage, 3),
            longest=check.longest_sentence,
            retried_ok=cv.check_level(second.turn.reply, scenario.cefr, vocabulary).ok,
        )
        return ModelTurn(
            second.turn,
            first.input_tokens + second.input_tokens,
            first.output_tokens + second.output_tokens,
            second.refused,
        )

    def _safe_reply(self, subgoals: Sequence[cv.Subgoal]) -> str:
        question = (
            f"Can you tell me: {subgoals[0].text.lower()}?" if subgoals else "How are you today?"
        )
        return SAFE_REPLY.format(question=question)

    def _starters(self, unit_id: str) -> list[str]:
        """Three phrases from the unit's functions, for the Help button (never the rude ones)."""
        out: list[str] = []
        for fn in self._catalog.units[unit_id].functions:
            for ex in fn.get("exponents", []):
                if ex.get("formality") != "rude" and ex.get("text") and ex["text"] not in out:
                    out.append(ex["text"])
                    break
            if len(out) == 3:
                break
        return out


async def purge_expired(
    sessionmaker: async_sessionmaker[AsyncSession], now: datetime
) -> dict[str, int]:
    """Transcripts are kept for the retention period and then deleted (docs/10 §8.9)."""
    async with sessionmaker() as session, session.begin():
        turns = await session.execute(delete(AiTurn).where(AiTurn.expires_at < now))
        conversations = await session.execute(
            delete(AiConversation).where(AiConversation.expires_at < now)
        )
        await session.execute(
            delete(AiUsageDaily).where(AiUsageDaily.day < (now - timedelta(days=60)).date())
        )
        return {
            "turns": int(getattr(turns, "rowcount", 0) or 0),
            "conversations": int(getattr(conversations, "rowcount", 0) or 0),
        }
