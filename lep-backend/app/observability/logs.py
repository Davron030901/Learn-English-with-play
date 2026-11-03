"""Structured JSON logging.

One pipeline renders everything. structlog loggers and standard-library loggers
(uvicorn, SQLAlchemy, Celery, asyncio) all go through the same ProcessorFormatter, so
every line is a single JSON object. The request middleware binds ``request_id`` in
contextvars, and ``merge_contextvars`` copies it onto every line emitted while that
request is being handled, whichever library emitted it.
"""

from __future__ import annotations

import logging
import sys
from typing import Any, TextIO

import structlog
from opentelemetry import trace
from structlog.types import EventDict, Processor, WrappedLogger

#: Keys whose values never reach a log sink, whoever logs them (compared case-insensitively).
SENSITIVE_KEYS = frozenset(
    {
        "password",
        "new_password",
        "passwd",
        "secret",
        "token",
        "access_token",
        "refresh_token",
        "authorization",
        "cookie",
        "set-cookie",
        "jwt",
        "api_key",
    }
)
REDACTED = "[redacted]"

#: Loggers that must not print on their own; their records propagate to the root handler.
_ROUTED_LOGGERS = (
    "uvicorn",
    "uvicorn.error",
    "celery",
    "celery.app.trace",
    "alembic",
    "py.warnings",
)


def _redact(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
    for key in event_dict:
        if key.lower() in SENSITIVE_KEYS:
            event_dict[key] = REDACTED
    return event_dict


def _add_trace_context(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
    context = trace.get_current_span().get_span_context()
    if context.is_valid:
        event_dict.setdefault("trace_id", format(context.trace_id, "032x"))
        event_dict.setdefault("span_id", format(context.span_id, "016x"))
    return event_dict


def _service(name: str) -> Processor:
    def add_service(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
        event_dict.setdefault("service", name)
        return event_dict

    return add_service


def configure_logging(
    *, level: str, json: bool, service: str, stream: TextIO | None = None
) -> None:
    """Install the logging pipeline. Safe to call again (tests redirect ``stream``)."""
    shared: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        _service(service),
        _add_trace_context,
        _redact,
    ]
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            *shared,
            structlog.processors.StackInfoRenderer(),
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    renderer: list[Processor]
    if json:
        renderer = [
            # Frame locals stay out of the log: a local can hold an email or a token, and
            # _redact only sees top-level keys.
            structlog.processors.ExceptionRenderer(
                structlog.tracebacks.ExceptionDictTransformer(show_locals=False)
            ),
            structlog.processors.JSONRenderer(default=str, ensure_ascii=False),
        ]
    else:
        renderer = [structlog.dev.ConsoleRenderer()]
    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared,
        processors=[structlog.stdlib.ProcessorFormatter.remove_processors_meta, *renderer],
    )

    handler = logging.StreamHandler(stream if stream is not None else sys.stdout)
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # Python warnings (deprecations, Celery's SecurityWarning) become log lines as well
    logging.captureWarnings(True)

    for name in _ROUTED_LOGGERS:
        routed = logging.getLogger(name)
        routed.handlers.clear()
        routed.propagate = True
    # The request middleware writes one access line per request, with the request id;
    # uvicorn's own access log would duplicate it without one.
    access = logging.getLogger("uvicorn.access")
    access.handlers.clear()
    access.propagate = False
    access.disabled = True
    # SQL statements can contain learner data; never log them at INFO.
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


def get_logger(name: str, **initial: Any) -> structlog.stdlib.BoundLogger:
    logger: structlog.stdlib.BoundLogger = structlog.stdlib.get_logger(name)
    return logger.bind(**initial) if initial else logger
