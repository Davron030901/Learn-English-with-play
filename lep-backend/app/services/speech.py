"""Voice recordings: consent, the daily ceiling, asynchronous scoring and deletion (Phase 8).

A recording is accepted only when a speech scorer is configured, the learner has given voice
consent and has not paused data collection (read under a lock, so a withdrawal in flight wins),
it is no longer than the cap, and today's seconds are within the uniform ceiling. Its length is
the larger of what the client says and what the audio itself proves (a WAV header, or the size
at the highest bitrate the app records at). It is stored with ``expires_at`` (≤ 30 days, docs/11
§10) and scored after the response is sent, so a lesson never waits on it; the app polls the job.

* **Pronunciation** — the scorer's measurement is judged by ``app.domain.pronunciation``: one
  headline, at most two notes, per-word and per-phone detail, the level's bar, never failed for
  accent.
* **Speaking task** — free speech: the transcript is rated on five criteria by the speaking rater
  and the sixth, phonology, comes from intelligibility (GOP means nothing without an expected
  text); the score goes through the same path as writing (evidence required, the κ gate, human
  audit) — and only while the recording still exists.

A recording the scorer could not finish is marked ``failed`` and its seconds are given back.
Deletion is real — the row and its audio — with a tombstone that keeps only that it existed.
"""

from __future__ import annotations

import base64
import binascii
import io
import math
import wave
from datetime import date, datetime, timedelta
from typing import Any, Final
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.rater import SPEAKING_PROMPT_VERSION, RaterUnavailable, SpeakingRater
from app.clock import Clock
from app.content.catalog import ContentCatalog
from app.domain import exam as ex
from app.domain.pronunciation import Measurement, judge, phonology_band
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
#: the highest bitrate the app records compressed speech at (bytes per second): a file cannot
#: be shorter than its size at this rate
MAX_COMPRESSED_BYTES_PER_S: Final = 8_000
#: a recording still queued after this was abandoned (a restart between 202 and the scoring)
STALE_QUEUED: Final = timedelta(hours=1)


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


def proven_seconds(audio: bytes, mime: str) -> int:
    """How long the audio must at least be, from the audio itself — never trusted from the
    client: a WAV states its length; a compressed file cannot be shorter than its size at the
    highest bitrate the app records at."""
    if mime == "audio/wav":
        try:
            with wave.open(io.BytesIO(audio)) as w:
                frames: int = w.getnframes()
                rate: int = w.getframerate()
                return math.ceil(frames / max(1, rate))
        except (wave.Error, EOFError):
            raise SpeechError("invalid", "not a readable WAV file") from None
    return math.ceil(len(audio) / MAX_COMPRESSED_BYTES_PER_S)


async def _usage_row(session: AsyncSession, learner_id: UUID, day: date) -> MediaUsageDaily:
    """The day's usage row, locked. Created first if missing (two first-of-day requests at once
    both get the row, rather than one failing on the key)."""
    await session.execute(
        insert(MediaUsageDaily)
        .values(learner_id=learner_id, day=day, tts_chars=0, speech_seconds=0)
        .on_conflict_do_nothing(index_elements=["learner_id", "day"])
    )
    row = await session.get(
        MediaUsageDaily, (learner_id, day), with_for_update=True, populate_existing=True
    )
    if row is None:  # the insert above guarantees it; only a concurrent account deletion can
        raise SpeechError("gone", "this account no longer exists")
    return row


async def _charge_seconds(
    session: AsyncSession, learner_id: UUID, day: date, seconds: int, ceiling: int
) -> None:
    row = await _usage_row(session, learner_id, day)
    if row.speech_seconds + seconds > ceiling:
        raise SpeechError("ceiling", "that is today's speech scoring")
    row.speech_seconds += seconds
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
    # FOR SHARE: a consent withdrawal or a pause committing now is seen, not raced
    settings = await session.get(
        LearnerSettings, learner_id, with_for_update={"read": True}, populate_existing=True
    )
    if settings is None:
        raise SpeechError("gone", "this account no longer exists")
    if not settings.voice_consent:
        raise SpeechError("consent", "voice recording needs your consent first")
    if settings.data_collection_paused:
        raise SpeechError("paused", "data collection is paused")
    if mime not in MIMES:
        raise SpeechError("invalid", "unsupported audio type")
    length = max(seconds, proven_seconds(audio, mime))
    if not 1 <= length <= max_seconds:
        raise SpeechError("invalid", f"a recording is 1 to {max_seconds} seconds")
    await _charge_seconds(session, learner_id, day, length, seconds_per_day)
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
        seconds=length,
        charged_day=day,
        status="queued",
        result=None,
        created_at=now,
        expires_at=now + timedelta(days=retention_days),
    )
    session.add(row)
    await session.flush()
    return row


def _words(m: Measurement, scores: dict[str, float]) -> list[dict[str, Any]]:
    """Per word, its score and every phone: the brief asks for phone-level scores (§10.2)."""
    return [
        {
            "word": w.text,
            "score": scores.get(w.text),
            "phones": [
                {
                    "expected": p.expected,
                    "heard": p.heard,
                    "gop": p.gop,
                    "contrastive": p.contrastive,
                    "substituted": p.substituted,
                }
                for p in w.phones
            ],
        }
        for w in m.words
    ]


async def score(
    sessionmaker: async_sessionmaker[AsyncSession],
    catalog: ContentCatalog,
    clock: Clock,
    scorer: SpeechScorer,
    rater: SpeakingRater | None,
    learner_id: UUID,
    recording_id: UUID,
) -> None:
    """Score one recording; the providers are asked outside any transaction. Whatever goes
    wrong, the recording ends ``failed`` with its seconds given back — never queued forever."""
    async with sessionmaker() as session, session.begin():
        row = await session.get(Recording, (learner_id, recording_id))
        if row is None or row.status != "queued":
            return
        audio, mime, expected, level = row.audio, row.mime, row.expected, row.level
        purpose, task_id = row.purpose, row.task_id
    try:
        free = purpose == "speaking_task"
        try:
            measured = await scorer.measure(audio, mime, None if free else expected)
        except ProviderUnavailable:
            await _fail(sessionmaker, learner_id, recording_id, "unavailable")
            return
        verdict = judge(measured, level, free=free)
        result: dict[str, Any] = {
            "headline": verdict.headline,
            "passed": verdict.passed,
            "notes": list(verdict.notes),
            "words": _words(measured, dict(verdict.word_scores)),
            "stress_accuracy": verdict.stress_accuracy,
            "intelligibility": verdict.intelligibility,
            "transcript": measured.transcript,
            "scorer": scorer.version,
        }
        if free and task_id is not None:
            result["score_id"] = await _rate_speaking(
                sessionmaker,
                catalog,
                clock,
                rater,
                learner_id,
                recording_id,
                task_id,
                measured,
                verdict.headline,
                scorer.version,
            )
        await _finish(sessionmaker, learner_id, recording_id, "scored", result)
    except Exception:  # noqa: BLE001 — a background task must always settle its recording
        _log.exception("speech_scoring_failed")
        await _fail(sessionmaker, learner_id, recording_id, "internal")


async def _rate_speaking(
    sessionmaker: async_sessionmaker[AsyncSession],
    catalog: ContentCatalog,
    clock: Clock,
    rater: SpeakingRater | None,
    learner_id: UUID,
    recording_id: UUID,
    task_id: str,
    measured: Measurement,
    headline: int,
    scorer_version: str,
) -> str | None:
    task = ex.speaking_task(task_id)
    if task is None or rater is None:
        return None
    try:
        rating = await rater.rate(
            level=task.level,
            prompt=task.prompt,
            transcript=measured.transcript,
            wpm=measured.speech_rate_wpm,
            pause_ratio=measured.pause_ratio,
        )
        scores = [
            *grounded(rating.criteria, measured.transcript),
            CriterionScore(
                "phonology",
                phonology_band(headline),
                (f"intelligibility {headline}/100 (independent recognition)",),
            ),
        ]
        rated = rate("speaking", scores)
    except (RaterUnavailable, RubricInvalid) as exc:
        _log.info("speaking_not_rated", reason=type(exc).__name__)
        return None
    async with sessionmaker() as session, session.begin():
        # the learner may have deleted the recording, or withdrawn consent, meanwhile: then
        # nothing derived from it is kept either
        alive = await session.get(
            Recording, (learner_id, recording_id), with_for_update=True, populate_existing=True
        )
        if alive is None:
            return None
        sub = ProductionSubmission(
            learner_id=learner_id,
            id=uuid7(),
            level=task.level,
            kind="speaking",
            task_id=task.id,
            prompt=task.prompt,
            text=measured.transcript,
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
            rater_version=f"{rating.version}+{scorer_version}",
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


async def _refund(session: AsyncSession, row: Recording) -> None:
    await session.execute(
        update(MediaUsageDaily)
        .where(MediaUsageDaily.learner_id == row.learner_id, MediaUsageDaily.day == row.charged_day)
        .values(speech_seconds=func.greatest(0, MediaUsageDaily.speech_seconds - row.seconds))
    )


async def _fail(
    sessionmaker: async_sessionmaker[AsyncSession],
    learner_id: UUID,
    recording_id: UUID,
    reason: str,
) -> None:
    """Nothing was scored: mark it so, and give the seconds back (ProviderUnavailable means
    nothing was charged)."""
    async with sessionmaker() as session, session.begin():
        row = await session.get(Recording, (learner_id, recording_id), with_for_update=True)
        if row is None or row.status != "queued":
            return
        row.status = "failed"
        row.result = {"error": reason}
        await _refund(session, row)


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
    """The daily job: every recording past its ``expires_at`` is deleted, with a tombstone;
    a recording abandoned in the queue is marked failed and its seconds given back."""
    async with sessionmaker() as session, session.begin():
        stale = (
            await session.execute(
                select(Recording)
                .where(Recording.status == "queued", Recording.created_at < now - STALE_QUEUED)
                .with_for_update(skip_locked=True)
            )
        ).scalars()
        abandoned = 0
        for row in stale:
            row.status = "failed"
            row.result = {"error": "abandoned"}
            await _refund(session, row)
            abandoned += 1
        gone = await session.execute(
            delete(Recording)
            .where(Recording.expires_at <= now)
            .returning(Recording.learner_id, Recording.id)
        )
        rows = [(r[0], r[1]) for r in gone]
        await _tombstone(session, rows, "expired", now)
        await session.execute(
            delete(MediaUsageDaily).where(MediaUsageDaily.day < (now - timedelta(days=60)).date())
        )
    return {"recordings": len(rows), "abandoned": abandoned}


async def job(
    session: AsyncSession, learner_id: UUID, recording_id: UUID, now: datetime
) -> Recording:
    row = await session.get(Recording, (learner_id, recording_id))
    # past its expiry a recording is gone for the learner, even before the nightly purge
    if row is None or row.expires_at <= now:
        raise SpeechError("not_found", "there is no such recording")
    return row


async def all_recordings(session: AsyncSession, learner_id: UUID, now: datetime) -> list[Recording]:
    rows = await session.execute(
        select(Recording)
        .where(Recording.learner_id == learner_id, Recording.expires_at > now)
        .order_by(Recording.created_at)
    )
    return [r for (r,) in rows]
