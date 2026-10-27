"""Celery entry point::

    celery --quiet -A app.workers.main:celery_app worker --loglevel=INFO
    celery --quiet -A app.workers.main:celery_app beat --loglevel=INFO

Importing this module reads ``WorkerSettings`` from the environment, and exits with
status 78 (EX_CONFIG) and a one-line JSON error if configuration is incomplete.
"""

from __future__ import annotations

import json
import sys

from app.config import ConfigError, WorkerSettings, load_settings
from app.workers.celery_app import create_celery

try:
    celery_app = create_celery(load_settings(WorkerSettings))
except ConfigError as exc:
    sys.stderr.write(
        json.dumps({"level": "critical", "event": "config_invalid", "detail": str(exc)}) + "\n"
    )
    raise SystemExit(78) from None
