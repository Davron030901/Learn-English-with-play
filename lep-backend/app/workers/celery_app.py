"""Celery application factory.

Delivery is at-least-once: a task is acknowledged only after it finishes
(``acks_late``) and is returned to the queue if its worker dies mid-task
(``reject_on_worker_lost``), so every task must be idempotent. Workers take one task
at a time (prefetch 1), which keeps long tasks from starving a queue.

Only JSON crosses the broker. Pickle would let anyone who can write to Redis run code
on the workers.
"""

from __future__ import annotations

from typing import Any

import structlog
from celery import Celery, signals
from celery.schedules import crontab

from app.config import WorkerSettings
from app.observability.logs import configure_logging

TASK_MODULES = ["app.workers.tasks"]

_settings: WorkerSettings | None = None


def worker_settings() -> WorkerSettings:
    """The settings the running Celery app was created with."""
    if _settings is None:
        raise RuntimeError("create_celery() has not been called in this process")
    return _settings


def create_celery(settings: WorkerSettings) -> Celery:
    global _settings  # one Celery app per process, created once at import
    _settings = settings
    app = Celery("lep", broker=settings.celery_broker_url(), include=TASK_MODULES)
    app.conf.update(
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        task_ignore_result=True,
        # no result backend, so no daily celery.backend_cleanup task either
        result_expires=None,
        task_acks_late=True,
        task_reject_on_worker_lost=True,
        task_time_limit=settings.celery_task_time_limit_s,
        task_soft_time_limit=max(settings.celery_task_time_limit_s - 30, 5),
        worker_prefetch_multiplier=1,
        worker_hijack_root_logger=False,
        broker_connection_retry_on_startup=True,
        broker_transport_options={
            # longer than the longest task, or a slow task would be delivered twice
            "visibility_timeout": settings.celery_task_time_limit_s * 2,
            "socket_timeout": settings.redis_socket_timeout_s,
            "socket_connect_timeout": settings.redis_connect_timeout_s,
        },
        timezone="UTC",
        enable_utc=True,
        beat_schedule={
            # 03:17 UTC: off the hour, and in the small hours for Uzbekistan (UTC+5)
            "purge-expired-auth-sessions": {
                "task": "lep.auth.purge_expired_sessions",
                "schedule": crontab(minute="17", hour="3"),
            },
            "purge-expired-recordings": {
                "task": "lep.media.purge_expired_recordings",
                "schedule": crontab(minute="29", hour="3"),
            },
            "seed-media-assets": {
                "task": "lep.media.seed_assets",
                "schedule": crontab(minute="5", hour="2"),
            },
            "tts-drafts": {
                "task": "lep.media.tts_drafts",
                "schedule": crontab(minute="35"),
            },
            "rater-bias-audit": {
                "task": "lep.assessment.bias_audit",
                "schedule": crontab(minute="41", hour="4", day_of_week="1"),
            },
            "purge-expired-ai-conversations": {
                "task": "lep.ai.purge_expired_conversations",
                "schedule": crontab(minute="23", hour="3"),
            },
            # the league week ends on Sunday at 20:00 in Tashkent, 15:00 UTC (docs/16 E23); any
            # week this misses is settled by its first member to ask
            "settle-league-weeks": {
                "task": "lep.leagues.settle",
                "schedule": crontab(minute="2", hour="15", day_of_week="0"),
            },
        },
    )
    return app


@signals.setup_logging.connect  # type: ignore[untyped-decorator]
def _configure_worker_logging(**_: Any) -> None:
    """Replace Celery's logging setup with the service's JSON pipeline."""
    settings = worker_settings()
    configure_logging(
        level=settings.log_level, json=settings.log_json, service=f"{settings.service_name}-worker"
    )


@signals.task_prerun.connect  # type: ignore[untyped-decorator]
def _bind_task_context(task_id: str | None = None, task: Any = None, **_: Any) -> None:
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(task_id=task_id, task_name=getattr(task, "name", None))


@signals.task_postrun.connect  # type: ignore[untyped-decorator]
def _clear_task_context(**_: Any) -> None:
    structlog.contextvars.clear_contextvars()
