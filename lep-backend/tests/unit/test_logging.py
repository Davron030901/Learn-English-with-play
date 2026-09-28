from __future__ import annotations

import io
import json
import logging
from collections.abc import Iterator

import pytest
import structlog

from app.observability.logs import REDACTED, configure_logging, get_logger


@pytest.fixture
def stream() -> Iterator[io.StringIO]:
    buffer = io.StringIO()
    configure_logging(level="INFO", json=True, service="lep-test", stream=buffer)
    yield buffer
    configure_logging(level="INFO", json=True, service="lep-test")


def _last(buffer: io.StringIO) -> dict[str, object]:
    line: dict[str, object] = json.loads(buffer.getvalue().splitlines()[-1])
    return line


def test_lines_are_single_json_objects_with_service_and_level(stream: io.StringIO) -> None:
    get_logger("tests").info("something_happened", count=3)
    line = _last(stream)
    assert line["event"] == "something_happened"
    assert line["count"] == 3
    assert line["service"] == "lep-test"
    assert line["level"] == "info"
    assert line["timestamp"]


def test_sensitive_keys_are_redacted_whoever_logs_them(stream: io.StringIO) -> None:
    get_logger("tests").info(
        "careless", password="p4ss", refresh_token="lep_rt_x", Authorization="Bearer y"
    )
    line = _last(stream)
    assert line["password"] == REDACTED
    assert line["refresh_token"] == REDACTED
    assert line["Authorization"] == REDACTED
    assert "p4ss" not in stream.getvalue()


def test_standard_library_loggers_share_the_pipeline_and_context(stream: io.StringIO) -> None:
    with structlog.contextvars.bound_contextvars(request_id="req-000001"):
        logging.getLogger("uvicorn.error").warning("from uvicorn")
    line = _last(stream)
    assert line["event"] == "from uvicorn"
    assert line["request_id"] == "req-000001"
    assert line["logger"] == "uvicorn.error"


def test_uvicorn_access_log_is_off_because_the_middleware_writes_its_own(
    stream: io.StringIO,
) -> None:
    logging.getLogger("uvicorn.access").info("GET / 200")
    assert stream.getvalue() == ""
