"""Background tasks. Each one is idempotent: running it twice has the effect of once."""

from __future__ import annotations

import asyncio
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from typing import Any

from celery import shared_task

from app.config import WorkerSettings
from app.db import create_engine, create_sessionmaker
from app.errors import is_dependency_failure
from app.observability.logs import get_logger
from app.repositories.auth_sessions import PurgeResult
from app.services.ai import purge_expired as purge_ai_records
from app.services.auth import purge_auth_records
from app.services.certification import bias_audit
from app.workers.celery_app import worker_settings

_log = get_logger("app.workers")


@shared_task(name="lep.ping")  # type: ignore[untyped-decorator]
def ping() -> str:
    """Liveness probe for the worker: ``celery -A app.workers.main:celery_app call lep.ping``."""
    return "pong"


async def purge_expired_auth_sessions_async(
    settings: WorkerSettings, *, now: datetime | None = None
) -> PurgeResult:
    engine = create_engine(
        settings,
        user=settings.db_user,
        password=settings.db_password,
        application_name=f"{settings.service_name}-worker",
        pooled=False,
    )
    try:
        cutoff = (now or datetime.now(UTC)) - timedelta(days=settings.auth_session_retention_days)
        return await purge_auth_records(create_sessionmaker(engine), cutoff=cutoff)
    finally:
        await engine.dispose()


async def purge_expired_ai_conversations_async(
    settings: WorkerSettings, *, now: datetime | None = None
) -> dict[str, int]:
    """Each conversation and turn carries its own ``expires_at``, set when it was written."""
    engine = create_engine(
        settings,
        user=settings.db_user,
        password=settings.db_password,
        application_name=f"{settings.service_name}-worker",
        pooled=False,
    )
    try:
        return await purge_ai_records(create_sessionmaker(engine), now or datetime.now(UTC))
    finally:
        await engine.dispose()


async def bias_audit_async(
    settings: WorkerSettings, *, now: datetime | None = None
) -> list[dict[str, Any]]:
    engine = create_engine(
        settings,
        user=settings.db_user,
        password=settings.db_password,
        application_name=f"{settings.service_name}-worker",
        pooled=False,
    )
    try:
        async with create_sessionmaker(engine)() as session, session.begin():
            return await bias_audit(session, (now or datetime.now(UTC)).year)
    finally:
        await engine.dispose()


RETRY_BACKOFF_MAX_S = 600


def retry_countdown(retries: int) -> int:
    """Exponential backoff for dependency failures: 1, 2, 4 … seconds, capped."""
    return int(min(RETRY_BACKOFF_MAX_S, 2**retries))


@shared_task(  # type: ignore[untyped-decorator]
    name="lep.auth.purge_expired_sessions",
    bind=True,
    max_retries=5,
)
def purge_expired_auth_sessions(self: Any) -> dict[str, int]:
    """Delete sessions and refresh tokens that ended more than the retention period ago."""
    try:
        result = asyncio.run(purge_expired_auth_sessions_async(worker_settings()))
    except Exception as exc:
        # retry only while the database is unreachable or overloaded — including errors
        # raised mid-query, which arrive wrapped in DBAPIError — never on a logic error
        if is_dependency_failure(exc):
            raise self.retry(exc=exc, countdown=retry_countdown(self.request.retries)) from exc
        raise
    _log.info("auth_records_purged", **asdict(result))
    return asdict(result)


@shared_task(  # type: ignore[untyped-decorator]
    name="lep.ai.purge_expired_conversations",
    bind=True,
    max_retries=5,
)
def purge_expired_ai_conversations(self: Any) -> dict[str, int]:
    """Delete AI-partner transcripts past their retention period (docs/10 §8.9)."""
    try:
        result = asyncio.run(purge_expired_ai_conversations_async(worker_settings()))
    except Exception as exc:
        if is_dependency_failure(exc):
            raise self.retry(exc=exc, countdown=retry_countdown(self.request.retries)) from exc
        raise
    _log.info("ai_conversations_purged", **result)
    return result


@shared_task(  # type: ignore[untyped-decorator]
    name="lep.assessment.bias_audit",
    bind=True,
    max_retries=5,
)
def run_bias_audit(self: Any) -> int:
    """Weekly: rater score distributions by L1 and age band; any gap > 0.3 bands alerts."""
    try:
        alerts = asyncio.run(bias_audit_async(worker_settings()))
    except Exception as exc:
        if is_dependency_failure(exc):
            raise self.retry(exc=exc, countdown=retry_countdown(self.request.retries)) from exc
        raise
    for alert in alerts:
        _log.warning("rater_bias_alert", **alert)
    _log.info("bias_audit_done", alerts=len(alerts))
    return len(alerts)


async def _with_sessionmaker(settings: WorkerSettings, fn: Any) -> Any:
    engine = create_engine(
        settings,
        user=settings.db_user,
        password=settings.db_password,
        application_name=f"{settings.service_name}-worker",
        pooled=False,
    )
    try:
        return await fn(create_sessionmaker(engine))
    finally:
        await engine.dispose()


async def purge_expired_recordings_async(
    settings: WorkerSettings, *, now: datetime | None = None
) -> dict[str, int]:
    from app.services.speech import purge_expired

    at = now or datetime.now(UTC)
    result: dict[str, int] = await _with_sessionmaker(settings, lambda sm: purge_expired(sm, at))
    return result


async def seed_assets_async(settings: WorkerSettings, *, now: datetime | None = None) -> int:
    from app.content.catalog import load_catalog_cached
    from app.services.media import seed_assets

    catalog = load_catalog_cached(settings.content_dir)
    at = now or datetime.now(UTC)

    async def run(sm: Any) -> int:
        async with sm() as session, session.begin():
            added: int = await seed_assets(session, catalog, at)
            return added

    result: int = await _with_sessionmaker(settings, run)
    return result


def _dependency_retry(task: Any, exc: Exception) -> None:
    if is_dependency_failure(exc):
        raise task.retry(exc=exc, countdown=retry_countdown(task.request.retries)) from exc
    raise exc


@shared_task(  # type: ignore[untyped-decorator]
    name="lep.media.purge_expired_recordings",
    bind=True,
    max_retries=5,
)
def purge_expired_recordings(self: Any) -> dict[str, int]:
    """Voice recordings past their retention are deleted, each leaving a tombstone."""
    try:
        result = asyncio.run(purge_expired_recordings_async(worker_settings()))
    except Exception as exc:
        _dependency_retry(self, exc)
        raise
    _log.info("recordings_purged", **result)
    return result


@shared_task(  # type: ignore[untyped-decorator]
    name="lep.media.seed_assets",
    bind=True,
    max_retries=5,
)
def seed_media_assets(self: Any) -> int:
    """Record every audio file the content refers to that is not yet known, as missing."""
    try:
        added = asyncio.run(seed_assets_async(worker_settings()))
    except Exception as exc:
        _dependency_retry(self, exc)
        raise
    _log.info("media_assets_seeded", added=added)
    return added


@shared_task(name="lep.media.tts_drafts")  # type: ignore[untyped-decorator]
def make_tts_drafts() -> dict[str, int]:
    """Synthetic drafts for missing audio; does nothing while no voice provider is configured."""
    settings = worker_settings()
    if settings.tts_provider == "none":
        _log.info("tts_drafts_skipped", reason="no provider configured")
        return {"made": 0, "failed": 0}
    raise NotImplementedError("a TTS provider adapter must be added with its provider setting")


async def settle_league_weeks_async(
    settings: WorkerSettings, *, now: datetime | None = None
) -> int:
    from app.clock import SystemClock
    from app.services.leagues import LeagueService

    class _At:
        def now(self) -> datetime:
            return now or SystemClock().now()

    async def run(sm: Any) -> int:
        async with sm() as session, session.begin():
            settled: int = await LeagueService(session, _At()).settle_ended()
            return settled

    result: int = await _with_sessionmaker(settings, run)
    return result


@shared_task(  # type: ignore[untyped-decorator]
    name="lep.leagues.settle",
    bind=True,
    max_retries=5,
)
def settle_league_weeks(self: Any) -> int:
    """Rank every league week that has ended and record each member's move. Idempotent."""
    try:
        settled = asyncio.run(settle_league_weeks_async(worker_settings()))
    except Exception as exc:
        _dependency_retry(self, exc)
        raise
    _log.info("league_weeks_settled", leagues=settled)
    return settled
