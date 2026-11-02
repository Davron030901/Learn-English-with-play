"""Prometheus metrics.

Each app instance owns its registry, so tests can build several apps in one process
and nothing is shared through the global default registry. Latency buckets bracket
the 300 ms p99 target from docs/00 §6 closely enough to read it off directly.

The routes are labelled by template (``/v1/units/{unit_id}``), never by raw path,
which would give every learner and unit its own time series.
"""

from __future__ import annotations

from collections.abc import Iterable

from prometheus_client import (
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from prometheus_client.core import GaugeMetricFamily, Metric
from prometheus_client.gc_collector import GCCollector
from prometheus_client.platform_collector import PlatformCollector
from prometheus_client.process_collector import ProcessCollector
from prometheus_client.registry import Collector
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.pool import QueuePool

LATENCY_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0, 2.5, 5.0, 10.0)


class _PoolCollector(Collector):
    """Reads the SQLAlchemy pool at scrape time instead of tracking it on every checkout."""

    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    def collect(self) -> Iterable[Metric]:
        pool = self._engine.pool
        family = GaugeMetricFamily(
            "db_pool_connections", "Database pool connections by state", labels=["state"]
        )
        if isinstance(pool, QueuePool):
            family.add_metric(["checked_out"], pool.checkedout())
            family.add_metric(["idle"], pool.checkedin())
            family.add_metric(["overflow"], max(pool.overflow(), 0))
            family.add_metric(["size"], pool.size())
        yield family


class Metrics:
    def __init__(self) -> None:
        self.registry = CollectorRegistry(auto_describe=True)
        ProcessCollector(registry=self.registry)
        PlatformCollector(registry=self.registry)
        GCCollector(registry=self.registry)

        self.http_requests = Counter(
            "http_requests_total",
            "HTTP requests handled",
            ["method", "route", "status"],
            registry=self.registry,
        )
        self.http_latency = Histogram(
            "http_request_duration_seconds",
            "HTTP request latency",
            ["method", "route"],
            buckets=LATENCY_BUCKETS,
            registry=self.registry,
        )
        self.http_in_flight = Gauge(
            "http_requests_in_flight", "HTTP requests being handled", registry=self.registry
        )
        self.rate_limited = Counter(
            "rate_limit_rejections_total",
            "Requests rejected by a rate limit",
            ["limit"],
            registry=self.registry,
        )
        self.rate_limiter_errors = Counter(
            "rate_limiter_errors_total",
            "Rate-limit checks that could not reach Redis, by what happened to the request",
            ["limit", "outcome"],
            registry=self.registry,
        )
        self.auth_events = Counter(
            "auth_events_total", "Authentication events", ["event"], registry=self.registry
        )
        self.dependency_failures = Counter(
            "dependency_failures_total",
            "Requests answered 503 because PostgreSQL or Redis was unavailable",
            registry=self.registry,
        )
        self.password_screen = Counter(
            "password_screen_total",
            "New passwords checked against common and breached ones, by outcome",
            ["outcome"],
            registry=self.registry,
        )
        self.mail_events = Counter(
            "mail_events_total",
            "Emails sent or failed, by kind",
            ["kind", "outcome"],
            registry=self.registry,
        )
        self.client_events = Counter(
            "client_events_total",
            "Events the apps report (an allow-list; no personal data), by name and platform",
            ["name", "platform"],
            registry=self.registry,
        )
        self._pool_collector: _PoolCollector | None = None

    def observe_request(self, *, method: str, route: str, status: int, seconds: float) -> None:
        self.http_requests.labels(method=method, route=route, status=str(status)).inc()
        self.http_latency.labels(method=method, route=route).observe(seconds)

    def bind_engine(self, engine: AsyncEngine) -> None:
        self.unbind_engine()
        self._pool_collector = _PoolCollector(engine)
        self.registry.register(self._pool_collector)

    def unbind_engine(self) -> None:
        if self._pool_collector is not None:
            self.registry.unregister(self._pool_collector)
            self._pool_collector = None

    def render(self) -> bytes:
        return generate_latest(self.registry)
