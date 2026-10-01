"""OpenTelemetry: off by default; when on, log lines carry the trace they belong to."""

from __future__ import annotations

import io
import json
import logging
import socket

import pytest

from app.config import Settings
from app.observability.logs import configure_logging
from tests.integration.conftest import start_app

pytestmark = pytest.mark.integration


def _closed_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
    return port


async def test_tracing_is_off_without_an_endpoint(settings: Settings) -> None:
    async with start_app(settings) as running:
        assert running.app.state.tracer_provider is None


async def test_sampled_requests_put_their_trace_id_on_every_log_line(settings: Settings) -> None:
    traced = settings.model_copy(
        update={
            # nothing listens here: exporting fails quietly, which is all this test needs
            "otel_exporter_otlp_endpoint": f"http://127.0.0.1:{_closed_port()}",
            "otel_sample_ratio": 1.0,
        }
    )
    stream = io.StringIO()
    async with start_app(traced) as running:
        assert running.app.state.tracer_provider is not None
        configure_logging(level="INFO", json=True, service="lep-test", stream=stream)
        logging.getLogger("httpx").setLevel(logging.WARNING)
        response = await running.client.get("/v1/me", headers={"X-Request-ID": "traced-0001"})
    configure_logging(level="INFO", json=True, service="lep-test")

    assert response.status_code == 401
    lines = [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]
    access = [line for line in lines if line.get("event") == "http_request"]
    assert len(access) == 1
    assert access[0]["request_id"] == "traced-0001"
    assert len(access[0]["trace_id"]) == 32
