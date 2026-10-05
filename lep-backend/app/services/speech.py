"""Voice recordings: consent, the daily ceiling, asynchronous scoring and deletion (Phase 8).

A recording is accepted only when a speech scorer is configured, the learner has given voice
consent and has not paused data collection, it is no longer than the cap, and today's seconds
are within the uniform ceiling. It is stored with ``expires_at`` (≤ 30 days, docs/11 §10) and
scored after the response is sent, so a lesson never waits on it; the app polls the job.

* **Pronunciation** — the scorer's measurement is judged by ``app.domain.pronunciation``: one
  headline, at most two notes, phone-level detail, the level's bar, never failed for accent.
* **Speaking task** — the transcript is rated on five criteria by the speaking rater and the
  sixth, phonology, comes from the pronunciation headline; the score goes through the same path
  as writing (evidence required, the κ gate, human audit).

Deletion is real — the row and its audio — with a tombstone that keeps only that it existed.
"""

from __future__ import annotations

import base64
import binascii
from datetime import date, datetime, timedelta
from typing import Any, Final
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.rater import SPEAKING_PROMPT_VERSION, RaterUnavailable, SpeakingRater
from app.clock import Clock
from app.content.catalog import ContentCatalog
from app.domain import exam as ex
from app.domain.pronunciation import judge, phonology_band
from app.domain.rubric import CriterionScore, RubricInvalid, rate
from app.ids import uuid7
from app.media.ports import ProviderUnavailable, SpeechScorer
from app.models.certification import ProductionSubmission
from app.models.learner import LearnerSettings
from app.models.media import MediaUsageDaily, Recording, RecordingTombstone
from app.observability.logs import get_logger
from app.services.certification import CertificationService, grounded

_log = get_logger("app.speech")

MIMES: Final = frozenset({"audio/ogg", "audio/webm", "audio/mp4", "audio/wav", "audio/mpeg"})
MAX_AUDIO_BYTES: Final = 2_000_000


class SpeechError(Exception):
    def __init__(self, kind: str, detail: str) -> None:
        super().__init__(detail)
        self.kind = kind


def decode_audio(b64: str) -> bytes:
    try:
        data = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise SpeechError("invalid", "audio must be base64") from None
    if not data or len(data) > MAX_AUDIO_BYTES:
        raise SpeechError("invalid", "audio is empty or too large")
    return data


async def _charge_seconds(
    session: AsyncSession, learner_id: UUID, day: date, seconds: int, ceiling: int
) -> None:
    row = await session.get(MediaUsageDaily, (learner_id, day), with_for_update=True)
    used = row.speech_seconds if row else 0
    if used + seconds > ceiling:
        raise SpeechError("ceiling", "that is today's speech scoring")
    if row is None:
        session.add(
            MediaUsageDaily(learner_id=learner_id, day=day, tts_chars=0, speech_seconds=seconds)
        )
    else:
        row.speech_seconds = used + seconds
    await session.flush()


async def accept(
    session: AsyncSession,
    *,
    learner_id: UUID,
    scorer_available: bool,
    purpose: str,
    level: str,
    audio: bytes,
    mime: str,
    seconds: int,
    expected: str | None,
    task_id: str | None,
    item_id: str | None,
    now: datetime,
    day: date,
    max_seconds: int,
    seconds_per_day: int,
    retention_days: int,
) -> Recording:
    if not scorer_available:
        raise SpeechError("unavailable", "speech scoring is not available on this server")
    settings = await session.get(LearnerSettings, learner_id)
    if settings is None:
        raise SpeechError("gone", "this account no longer exists")
    if not settings.voice_consent:
        raise SpeechError("consent", "voice recording needs your consent first")
    if settings.data_collection_paused:
        raise SpeechError("paused", "data collection is paused")
    if mime not in MIMES:
        raise SpeechError("invalid", "unsupported audio type")
    if not 1 <= seconds <= max_seconds:
        raise SpeechError("invalid", f"a recording is 1 to {max_seconds} seconds")
    await _charge_seconds(session, learner_id, day, seconds, seconds_per_day)
    row = Recording(
        learner_id=learner_id,
        id=uuid7(),
        purpose=purpose,
        level=level,
        expected=expected,
        task_id=task_id,
        item_id=item_id,
        audio=audio,
        mime=mime,
        seconds=seconds,
        status="queued",
        result=None,
        created_at=now,
        expires_at=now + timedelta(days=retention_days),
    )
    session.add(row)
    await session.flush()
    return row


async def score(
    sessionmaker: async_sessionmaker[AsyncSession],
    catalog: ContentCatalog,
    clock: Clock,
    scorer: SpeechScorer,
    rater: SpeakingRater | None,
    learner_id: UUID,
    recording_id: UUID,
) -> None:
    """Score one recording; the providers are asked outside any transaction."""
    async with sessionmaker() as session, session.begin():
        row = await session.get(Recording, (learner_id, recording_id))
        if row is None or row.status != "queued":
            return
        audio, mime, expected, level = row.audio, row.mime, row.expected, row.level
        purpose, task_id = row.purpose, row.task_id
    try:
        measured = await scorer.measure(audio, mime, expected)
    except ProviderUnavailable:
        await _finish(sessionmaker, learner_id, recording_id, "failed", {"error": "unavailable"})
        return
    verdict = judge(measured, level)
    result: dict[str, Any] = {
        "headline": verdict.headline,
        "passed": verdict.passed,
        "notes": list(verdict.notes),
        "words": [{"word": w, "score": s} for w, s in verdict.word_scores],
        "stress_accuracy": verdict.stress_accuracy,
        "intelligibility": verdict.intelligibility,
        "transcript": measured.transcript,
        "scorer": scorer.version,
    }
    if purpose == "speaking_task" and task_id is not None:
        result["score_id"] = await _rate_speaking(
            sessionmaker,
            catalog,
            clock,
            rater,
            learner_id,
            task_id,
            measured.transcript,
            measured.speech_rate_wpm,
            measured.pause_ratio,
            verdict.headline,
            list(verdict.notes),
            scorer.version,
        )
    await _finish(sessionmaker, learner_id, recording_id, "scored", result)


async def _rate_speaking(
    sessionmaker: async_sessionmaker[AsyncSession],
    catalog: ContentCatalog,
    clock: Clock,
    rater: SpeakingRater | None,
    learner_id: UUID,
    task_id: str,
    transcript: str,
    wpm: float | None,
    pause_ratio: float | None,
    headline: int,
    notes: list[str],
    scorer_version: str,
) -> str | None:
    task = ex.speaking_task(task_id)
    if task is None or rater is None:
        return None
    try:
        raw = await rater.rate(
            level=task.level,
            prompt=task.prompt,
            transcript=transcript,
            wpm=wpm,
            pause_ratio=pause_ratio,
        )
        scores = [
            *grounded(raw, transcript),
            CriterionScore(
                "phonology",
                phonology_band(headline),
                (f"pronunciation headline {headline}/100", *notes),
            ),
        ]
        rated = rate("speaking", scores)
    except (RaterUnavailable, RubricInvalid) as exc:
        _log.info("speaking_not_rated", reason=type(exc).__name__)
        return None
    async with sessionmaker() as session, session.begin():
        sub = ProductionSubmission(
            learner_id=learner_id,
            id=uuid7(),
            level=task.level,
            kind="speaking",
            task_id=task.id,
            prompt=task.prompt,
            text=transcript,
            status="awaiting_rater",
            created_at=clock.now(),
        )
        session.add(sub)
        await session.flush()
        stored = await CertificationService(session, catalog, clock).store_score(
            learner_id,
            sub.id,
            rated,
            rater_kind="llm",
            rater_version=f"{rater.version}+{scorer_version}",
            prompt_version=SPEAKING_PROMPT_VERSION,
        )
        return str(stored.id)


async def _finish(
    sessionmaker: async_sessionmaker[AsyncSession],
    learner_id: UUID,
    recording_id: UUID,
    status: str,
    result: dict[str, Any],
) -> None:
    async with sessionmaker() as session, session.begin():
        row = await session.get(Recording, (learner_id, recording_id), with_for_update=True)
        if row is not None:  # deleted while it was being scored: nothing to keep
            row.status = status
            row.result = result


# ------------------------------------------------------------------- deletion


async def _tombstone(
    session: AsyncSession, rows: list[tuple[UUID, UUID]], reason: str, now: datetime
) -> None:
    for learner_id, recording_id in rows:
        await session.merge(
            RecordingTombstone(
                learner_id=learner_id, recording_id=recording_id, reason=reason, deleted_at=now
            )
        )


async def delete_recordings(
    session: AsyncSession, learner_id: UUID, now: datetime, reason: str = "learner"
) -> int:
    gone = await session.execute(
        delete(Recording)
        .where(Recording.learner_id == learner_id)
        .returning(Recording.learner_id, Recording.id)
    )
    rows = [(r[0], r[1]) for r in gone]
    await _tombstone(session, rows, reason, now)
    return len(rows)


async def purge_expired(
    sessionmaker: async_sessionmaker[AsyncSession], now: datetime
) -> dict[str, int]:
    """The daily job: every recording past its ``expires_at`` is deleted, with a tombstone."""
    async with sessionmaker() as session, session.begin():
        gone = await session.execute(
            delete(Recording)
            .where(Recording.expires_at < now)
            .returning(Recording.learner_id, Recording.id)
        )
        rows = [(r[0], r[1]) for r in gone]
        await _tombstone(session, rows, "expired", now)
        await session.execute(
            delete(MediaUsageDaily).where(MediaUsageDaily.day < (now - timedelta(days=60)).date())
        )
    return {"recordings": len(rows)}


async def job(session: AsyncSession, learner_id: UUID, recording_id: UUID) -> Recording:
    row = await session.get(Recording, (learner_id, recording_id))
    if row is None:
        raise SpeechError("not_found", "there is no such recording")
    return row


def recording_meta(r: Recording) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "purpose": r.purpose,
        "level": r.level,
        "expected": r.expected,
        "task_id": r.task_id,
        "item_id": r.item_id,
        "mime": r.mime,
        "seconds": r.seconds,
        "status": r.status,
        "result": r.result,
        "created_at": r.created_at.isoformat(),
        "expires_at": r.expires_at.isoformat(),
    }


async def all_recordings(session: AsyncSession, learner_id: UUID) -> list[Recording]:
    rows = await session.execute(
        select(Recording).where(Recording.learner_id == learner_id).order_by(Recording.created_at)
    )
    return [r for (r,) in rows]
