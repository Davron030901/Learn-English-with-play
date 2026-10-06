"""Load test for the hot path: ``python -m scripts.loadtest --base-url URL [options]``.

Each virtual learner signs up, then loops for the duration: open a session (``POST
/v1/sessions``: a tier-1 lesson the first time, then a ten-minute session of what is due, as a
returning learner opens), sync a batch of ten answers in it (``POST /v1/sync/reviews``), send
one answer (``POST /v1/reviews``) and read the due queue (``GET /v1/reviews/due``). The answers
are real multiple-choice items from the packed course, right or wrong at random, so the server
grades, schedules and awards exactly as it does for a learner. Every request must succeed: a
refusal (such as the day's new-material cap) counts as a failure, never as a served request.

The report gives p50 / p95 / p99 per endpoint; the exit status is 1 when the p99 of the
session or review endpoints is above ``--p99-ms`` (backend brief §13: 300 ms), or when any
request failed. Registration is set-up, not measured. The API's rate limits must allow the
traffic (one IP sends all of it): raise ``LEP_RATE_LIMIT_*`` for the run.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import random
import sys
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from app.config import DEFAULT_CONTENT_DIR
from app.content.catalog import ContentCatalog, ItemRecord, load_catalog_cached

#: the endpoints the acceptance criterion names (Phase 9: "the session and review endpoints")
GATED = ("POST /v1/sessions", "POST /v1/sync/reviews", "POST /v1/reviews")
#: the statuses that mean the request was served
EXPECTED = {200, 201}


@dataclass
class Report:
    latencies: dict[str, list[float]] = field(default_factory=lambda: defaultdict(list))
    failures: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    statuses: dict[str, dict[int, int]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(int))
    )

    def add(self, name: str, seconds: float, status: int) -> None:
        self.latencies[name].append(seconds * 1000)
        self.statuses[name][status] += 1
        if status not in EXPECTED:
            self.failures[name] += 1

    def summary(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for name, values in sorted(self.latencies.items()):
            ordered = sorted(values)
            out[name] = {
                "requests": len(ordered),
                "p50_ms": round(_pct(ordered, 50), 1),
                "p95_ms": round(_pct(ordered, 95), 1),
                "p99_ms": round(_pct(ordered, 99), 1),
                "max_ms": round(ordered[-1], 1),
                "failures": self.failures.get(name, 0),
                "statuses": dict(self.statuses[name]),
            }
        return out


def _pct(ordered: list[float], p: float) -> float:
    """Nearest-rank percentile: the smallest value with at least p % of samples at or below."""
    if not ordered:
        return 0.0
    k = max(0, min(len(ordered) - 1, math.ceil(p / 100 * len(ordered)) - 1))
    return ordered[k]


def _choice_items(catalog: ContentCatalog) -> list[ItemRecord]:
    return [
        i
        for i in catalog.items.values()
        if i.type_id.startswith("mcq_") and "index" in i.answer and "options" in i.prompt
    ][:400]


def _record(item: ItemRecord, rng: random.Random, session_id: str) -> dict[str, Any]:
    index = int(item.answer["index"])
    options = item.prompt["options"]
    right = rng.random() < 0.8
    return {
        "kind": "review",
        "client_uuid": str(uuid.uuid4()),
        "created_at": datetime.now(UTC).isoformat(),
        "monotonic_ms": 0,
        "payload": {
            "item_id": item.id,
            "session_id": session_id,
            "submission": {
                "kind": "choice",
                "index": index if right else (index + 1) % len(options),
            },
            "rt_ms": rng.randint(1_500, 9_000),
            "hints_used": 0,
            "plays_used": 0,
            "content_version": "loadtest",
            "local_verdict": "correct" if right else "incorrect",
            "local_typo": False,
        },
    }


async def _timed(
    report: Report, name: str, call: Any, *args: Any, **kwargs: Any
) -> httpx.Response | None:
    started = time.perf_counter()
    try:
        response: httpx.Response = await call(*args, **kwargs)
    except httpx.HTTPError:
        report.add(name, time.perf_counter() - started, 599)
        return None
    report.add(name, time.perf_counter() - started, response.status_code)
    return response


async def _sign_up(client: httpx.AsyncClient, n: int) -> str:
    body = {
        "email": f"load-{uuid.uuid4().hex[:12]}-{n}@example.org",
        "password": f"Load-test-{uuid.uuid4().hex}",
        "birth_year": 1995,
        "l1": "uz",
        "tz": "Asia/Tashkent",
    }
    r = await client.post("/v1/auth/register", json=body)
    if r.status_code != 201:
        raise RuntimeError(f"sign-up failed: {r.status_code} {r.text[:200]}")
    token: str = r.json()["tokens"]["access_token"]
    return token


async def _learner(
    client: httpx.AsyncClient,
    token: str,
    items: list[ItemRecord],
    nodes: list[str],
    until: float,
    report: Report,
    seed: int,
) -> None:
    rng = random.Random(seed)  # noqa: S311 — traffic shape, not secrets
    auth = {"Authorization": f"Bearer {token}"}
    first = True
    while time.perf_counter() < until:
        # the day's first lesson always opens (docs/08 §5); after it, the day's new material is
        # soon used up, so a returning learner opens what is due
        body: dict[str, Any] = (
            {"minutes": 10, "node_id": rng.choice(nodes), "tier": 1} if first else {"minutes": 10}
        )
        first = False
        opened = await _timed(
            report, "POST /v1/sessions", client.post, "/v1/sessions", json=body, headers=auth
        )
        # the lesson's answers carry its id, as the app's do
        session_id = (
            str(opened.json()["id"])
            if opened is not None and opened.status_code == 201
            else str(uuid.uuid4())
        )
        batch = [_record(rng.choice(items), rng, session_id) for _ in range(10)]
        await _timed(
            report,
            "POST /v1/sync/reviews",
            client.post,
            "/v1/sync/reviews",
            json={"records": batch},
            headers=auth,
        )
        await _timed(
            report,
            "POST /v1/reviews",
            client.post,
            "/v1/reviews",
            json=_record(rng.choice(items), rng, session_id),
            headers=auth,
        )
        await _timed(report, "GET /v1/reviews/due", client.get, "/v1/reviews/due", headers=auth)


async def run(
    base_url: str, *, learners: int, seconds: float, content_dir: Path = DEFAULT_CONTENT_DIR
) -> dict[str, Any]:
    catalog = load_catalog_cached(content_dir)
    items = _choice_items(catalog)
    order = catalog.unit_order()[:3]
    nodes = [
        n.id for n in catalog.nodes.values() if n.unit_id in order and 1 in n.tiers and n.tiers[1]
    ]
    report = Report()
    limits = httpx.Limits(max_connections=learners * 2, max_keepalive_connections=learners * 2)
    async with httpx.AsyncClient(base_url=base_url, timeout=30, limits=limits) as client:
        tokens = []
        for start in range(0, learners, 10):  # sign-up is Argon2id: a few at a time
            tokens += await asyncio.gather(
                *(_sign_up(client, n) for n in range(start, min(learners, start + 10)))
            )
        until = time.perf_counter() + seconds
        await asyncio.gather(
            *(
                _learner(client, token, items, nodes, until, report, seed)
                for seed, token in enumerate(tokens)
            )
        )
    return {"learners": learners, "seconds": seconds, "endpoints": report.summary()}


def verdict(result: dict[str, Any], p99_ms: float) -> list[str]:
    """What fails the acceptance criterion; empty when it is met."""
    problems = []
    for name, row in result["endpoints"].items():
        if row["failures"]:
            problems.append(f"{name}: {row['failures']} failed requests ({row['statuses']})")
        if name in GATED and row["p99_ms"] > p99_ms:
            problems.append(f"{name}: p99 {row['p99_ms']} ms > {p99_ms} ms")
    return problems


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--base-url", default=os.environ.get("LEP_LOAD_BASE_URL", "http://127.0.0.1:8000")
    )
    parser.add_argument("--learners", type=int, default=50, help="concurrent virtual learners")
    parser.add_argument("--seconds", type=float, default=60.0, help="how long to run")
    parser.add_argument("--p99-ms", type=float, default=300.0)
    args = parser.parse_args(argv[1:])
    result = asyncio.run(run(args.base_url, learners=args.learners, seconds=args.seconds))
    print(json.dumps(result, indent=2))
    problems = verdict(result, args.p99_ms)
    for p in problems:
        print(f"FAIL {p}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
