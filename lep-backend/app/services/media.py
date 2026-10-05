"""Audio assets: the honest audio situation and the TTS draft pipeline (backend brief §10.1).

The content refers to ~10,500 item audio files and none exist. ``seed_assets`` records every one
as ``missing``, with the text it should say (the item's own ``say``). ``tts_drafts`` asks the
configured voice for any missing asset and marks it ``tts_draft`` — the API then says
``source: synthetic`` so the app can tell the learner. Human recordings arrive as WAV masters and
pass ``qc_master`` (48 kHz mono, -16 LUFS ± 1, no clipping, trimmed) to become ``qc_passed``.

On-demand speech (``POST /v1/media/tts``) is cached by text and limited by a uniform daily
ceiling of characters per learner; it is never sold.
"""

from __future__ import annotations

import hashlib
import io
import wave
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path, PurePosixPath
from typing import Any, Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.content.catalog import ContentCatalog
from app.domain import audio_qc
from app.media.ports import ProviderUnavailable, TtsEngine
from app.models.media import MediaAsset, MediaUsageDaily
from app.observability.logs import get_logger

_log = get_logger("app.media")

TTS_CACHE: Final = "tts"
MAX_TTS_CHARS: Final = 400


class MediaError(Exception):
    def __init__(self, kind: str, detail: str) -> None:
        super().__init__(detail)
        self.kind = kind


def safe_path(root: Path, relative: str) -> Path:
    """A path inside ``root`` for a content-relative name; anything that escapes is refused."""
    parts = PurePosixPath(relative).parts
    if not parts or any(p in ("..", "") or p.startswith("/") or ":" in p for p in parts):
        raise MediaError("invalid", "not a media path")
    target = root.joinpath(*parts).resolve()
    if root.resolve() not in target.parents:
        raise MediaError("invalid", "not a media path")
    return target


def asset_texts(catalog: ContentCatalog) -> dict[str, str]:
    """Audio path → the text it should say, from the items that refer to it."""
    out: dict[str, str] = {}
    for item in catalog.items.values():
        path = item.prompt.get("audio")
        if isinstance(path, str) and item.say:
            out.setdefault(path, item.say)
    return out


async def seed_assets(session: AsyncSession, catalog: ContentCatalog, now: datetime) -> int:
    """Record every referenced audio file not yet known as ``missing``. Idempotent."""
    rows = [
        {"path": p, "text": t, "status": "missing", "updated_at": now}
        for p, t in sorted(asset_texts(catalog).items())
    ]
    added = 0
    for k in range(0, len(rows), 1000):
        result = await session.execute(
            insert(MediaAsset)
            .values(rows[k : k + 1000])
            .on_conflict_do_nothing(index_elements=["path"])
            .returning(MediaAsset.path)
        )
        added += len(result.all())
    return added


async def tts_drafts(
    sessionmaker: async_sessionmaker[AsyncSession],
    tts: TtsEngine,
    media_dir: Path,
    now: datetime,
    *,
    limit: int = 200,
) -> dict[str, int]:
    """Synthesise drafts for up to ``limit`` missing assets; the provider is asked outside any
    transaction, and each asset is stored on its own so one failure costs one asset."""
    async with sessionmaker() as session, session.begin():
        todo = [
            (a.path, a.text)
            for (a,) in await session.execute(
                select(MediaAsset)
                .where(MediaAsset.status == "missing")
                .order_by(MediaAsset.path)
                .limit(limit)
            )
        ]
    made = failed = 0
    for path, text in todo:
        try:
            audio = await tts.synthesise(text)
        except ProviderUnavailable:
            failed += 1
            continue
        target = safe_path(media_dir, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(audio.audio)
        async with sessionmaker() as session, session.begin():
            row = await session.get(MediaAsset, path, with_for_update=True)
            if row is None or row.status != "missing":
                continue  # a human recording arrived meanwhile: never overwrite it
            row.status = "tts_draft"
            row.made_by = tts.version
            row.sha256 = hashlib.sha256(audio.audio).hexdigest()
            row.bytes = len(audio.audio)
            row.duration_ms = audio.duration_ms
            row.updated_at = now
        made += 1
    _log.info("tts_drafts", made=made, failed=failed, asked=len(todo))
    return {"made": made, "failed": failed}


@dataclass(frozen=True, slots=True)
class AssetView:
    path: str
    status: str
    source: str
    text: str
    made_by: str | None


def source_of(status: str) -> str:
    return {"missing": "none", "tts_draft": "synthetic"}.get(status, "recorded")


async def asset(session: AsyncSession, path: str) -> AssetView:
    row = await session.get(MediaAsset, path)
    if row is None:
        raise MediaError("not_found", "there is no such audio")
    return AssetView(row.path, row.status, source_of(row.status), row.text, row.made_by)


# ------------------------------------------------------------------- human recordings


def read_wav(data: bytes) -> tuple[list[float], int, int]:
    """Mono-mixed float samples, rate and channel count of a 16-bit PCM WAV."""
    with wave.open(io.BytesIO(data)) as w:
        rate, channels, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        frames = w.readframes(w.getnframes())
    if width != 2:
        raise MediaError("invalid", "masters are 16-bit PCM WAV")
    ints = [
        int.from_bytes(frames[i : i + 2], "little", signed=True) for i in range(0, len(frames), 2)
    ]
    mono = [sum(ints[i : i + channels]) / channels / 32768 for i in range(0, len(ints), channels)]
    return mono, rate, channels


async def qc_master(
    session: AsyncSession, path: str, master: bytes, encoded: bytes, made_by: str, now: datetime
) -> audio_qc.QcReport:
    """A human recording: QC the WAV master; the encoded file is what learners get."""
    samples, rate, channels = read_wav(master)
    report = audio_qc.check(samples, rate=rate, channels=channels, encoded_bytes=len(encoded))
    row = await session.get(MediaAsset, path, with_for_update=True)
    if row is None:
        raise MediaError("not_found", "there is no such audio")
    row.status = "qc_passed" if report.passed else "recorded"
    row.made_by = made_by
    row.sha256 = hashlib.sha256(encoded).hexdigest()
    row.bytes = len(encoded)
    row.duration_ms = int(report.duration_s * 1000)
    row.qc = {
        "passed": report.passed,
        "problems": list(report.problems),
        "loudness_lufs": report.loudness_lufs,
        "peak": report.peak,
    }
    row.updated_at = now
    return report


# ------------------------------------------------------------------- on-demand speech


async def _charge_chars(
    session: AsyncSession, learner_id: UUID, day: date, chars: int, ceiling: int
) -> None:
    row = await session.get(MediaUsageDaily, (learner_id, day), with_for_update=True)
    used = row.tts_chars if row else 0
    if used + chars > ceiling:
        raise MediaError("ceiling", "that is today's synthesised speech")
    if row is None:
        session.add(
            MediaUsageDaily(learner_id=learner_id, day=day, tts_chars=chars, speech_seconds=0)
        )
    else:
        row.tts_chars = used + chars
    await session.flush()


async def speak(
    session: AsyncSession,
    tts: TtsEngine | None,
    media_dir: Path,
    learner_id: UUID,
    text: str,
    day: date,
    ceiling: int,
) -> dict[str, Any]:
    """Synthesised speech for a short text; cached by text, so a repeat costs nothing."""
    if tts is None:
        raise MediaError("unavailable", "synthesised speech is not available on this server")
    text = " ".join(text.split())
    if not text or len(text) > MAX_TTS_CHARS:
        raise MediaError("invalid", f"1 to {MAX_TTS_CHARS} characters")
    key = hashlib.sha256(f"{tts.version}\x1f{text}".encode()).hexdigest()
    relative = f"{TTS_CACHE}/{key[:2]}/{key}.ogg"
    target = safe_path(media_dir, relative)
    if not target.exists():
        await _charge_chars(session, learner_id, day, len(text), ceiling)
        try:
            audio = await tts.synthesise(text)
        except ProviderUnavailable as exc:
            raise MediaError(
                "unavailable", "synthesised speech is not available right now"
            ) from exc
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(audio.audio)
    return {"path": relative, "source": "synthetic", "voice": tts.version}
