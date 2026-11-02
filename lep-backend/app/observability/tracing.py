"""OpenTelemetry tracing, switched on by ``LEP_OTEL_EXPORTER_OTLP_ENDPOINT``.

Spans are exported over OTLP/HTTP in batches. Log lines carry ``trace_id`` and
``span_id`` whenever a sampled span is active (see ``logs._add_trace_context``), so a
trace and its log lines can be joined in either direction.
"""

from __future__ import annotations

from fastapi import FastAPI
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

from app import __version__
from app.config import CommonSettings

#: Probes and scrapes would otherwise dominate the sampled traces.
_UNTRACED = "health,ready,metrics"


def setup_tracing(app: FastAPI, settings: CommonSettings) -> TracerProvider | None:
    if settings.otel_exporter_otlp_endpoint is None:
        return None
    provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": settings.service_name,
                "service.version": __version__,
                "deployment.environment": settings.env,
            }
        ),
        # A client's traceparent must not force 100 % sampling: remote parents are sampled at
        # the same ratio as roots, whatever flag they carry.
        sampler=ParentBased(
            root=TraceIdRatioBased(settings.otel_sample_ratio),
            remote_parent_sampled=TraceIdRatioBased(settings.otel_sample_ratio),
            remote_parent_not_sampled=TraceIdRatioBased(settings.otel_sample_ratio),
        ),
    )
    exporter = OTLPSpanExporter(
        endpoint=f"{settings.otel_exporter_otlp_endpoint}/v1/traces", timeout=5
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider, excluded_urls=_UNTRACED)
    return provider
