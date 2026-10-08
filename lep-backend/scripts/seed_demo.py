"""Create the demo learner: ``make demo`` (``python -m scripts.seed_demo``).

For local and development stacks only: it refuses to run with ``LEP_ENV=prod``. It is
idempotent — when the demo account exists it says so and changes nothing. Everything goes
through the API in process, with the same grading, scheduling and awards as a real learner, so
the demo shows what the app would show:

* parts of Unit 1 practised nine days ago, so the garden has reviews due today;
* the first lesson of Unit 2 played;
* Unit 1 tested out (its stamps, gems and XP).

The email is ``demo@learn-english.example``. The password is read from ``LEP_DEMO_PASSWORD``, or
from the ``lep_demo_password`` file in the secrets directory (``make secrets`` creates it); it is
never printed.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

from app.config import DEFAULT_SECRETS_DIR, SECRETS_DIR_ENV, ConfigError, Settings, load_settings
from app.content.answers import correct_submission
from app.content.catalog import ContentCatalog, ItemRecord
from app.main import build_app

DEMO_EMAIL = "demo@learn-english.example"
TESTED_OUT = "S01U01"
LESSON = ("S01U02N1", 1)
#: how long ago Unit 1 was first practised: long enough that its reviews are due today
PRACTICE_DAYS_AGO = 9


def _password() -> str | None:
    value = os.environ.get("LEP_DEMO_PASSWORD")
    if value:
        return value
    secrets = Path(os.environ.get(SECRETS_DIR_ENV, str(DEFAULT_SECRETS_DIR)))
    file = secrets / "lep_demo_password"
    return file.read_text(encoding="utf-8").strip() if file.is_file() else None


def _record(item: ItemRecord, session_id: str, at: datetime) -> dict[str, Any] | None:
    submission = correct_submission(item)
    if submission is None or submission.get("kind") == "speech":
        return None  # nothing to say without a voice, and no key to type
    return {
        "kind": "review",
        "client_uuid": str(uuid.uuid4()),
        "created_at": at.isoformat(),
        "monotonic_ms": 0,
        "payload": {
            "item_id": item.id,
            "session_id": session_id,
            "submission": submission,
            "rt_ms": 6000,
            "hints_used": 0,
            "plays_used": 1,
            "content_version": "demo-seed",
            "local_verdict": "correct",
            "local_typo": False,
        },
    }


async def _sync(
    client: httpx.AsyncClient, auth: dict[str, str], records: list[dict[str, Any]]
) -> None:
    for start in range(0, len(records), 400):
        r = await client.post(
            "/v1/sync/reviews", json={"records": records[start : start + 400]}, headers=auth
        )
        r.raise_for_status()


async def seed(settings: Settings, password: str) -> dict[str, Any]:
    app = build_app(settings)
    async with app.router.lifespan_context(app):
        catalog: ContentCatalog = app.state.container.content
        transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 50_000))
        async with httpx.AsyncClient(transport=transport, base_url="http://seed") as client:
            registered = await client.post(
                "/v1/auth/register",
                json={
                    "email": DEMO_EMAIL,
                    "password": password,
                    "l1": "uz",
                    "birth_year": 2000,
                    "tz": "Asia/Tashkent",
                },
            )
            if registered.status_code == 409:
                return {
                    "demo": DEMO_EMAIL,
                    "created": False,
                    "note": "the demo learner already exists; nothing changed",
                }
            registered.raise_for_status()
            auth = {"Authorization": f"Bearer {registered.json()['tokens']['access_token']}"}
            now = datetime.now(UTC)

            # the test-out's form first, so the practice below can leave its memory items alone
            form = (
                await client.post(
                    "/v1/assessment/checkpoints", json={"unit_id": TESTED_OUT}, headers=auth
                )
            ).json()
            tested_memory = {m for i in form["item_ids"] for m in catalog.items[i].memory_items}

            # 1. Unit 1 practised nine days ago — the parts the test-out does not ask about, so
            #    they are due for review today
            unit = catalog.units[TESTED_OUT]
            practised = [
                catalog.items[i]
                for node_id in unit.node_ids
                for i in catalog.nodes[node_id].tiers.get(1, ())
                if not tested_memory & set(catalog.items[i].memory_items)
            ]
            session = str(uuid.uuid4())
            at = now - timedelta(days=PRACTICE_DAYS_AGO)
            batch = [
                r
                for k, item in enumerate(practised)
                if (r := _record(item, session, at + timedelta(seconds=20 * k))) is not None
            ]
            await _sync(client, auth, batch)

            # 2. the first lesson of Unit 2 — before the test-out, which uses up the day's new
            #    material: the day's first lesson is always allowed (docs/08 §5)
            node_id, tier = LESSON
            plan = await client.post(
                "/v1/sessions", json={"minutes": 10, "node_id": node_id, "tier": tier}, headers=auth
            )
            lesson_done = False
            lesson_note = f"{plan.status_code} {plan.json().get('type', '')}".strip()
            if plan.status_code == 201:
                steps = [s for s in plan.json()["steps"] if s.get("item_id")]
                start = now
                batch = [
                    r
                    for k, s in enumerate(steps)
                    if (
                        r := _record(
                            catalog.items[s["item_id"]],
                            plan.json()["id"],
                            start + timedelta(seconds=15 * k),
                        )
                    )
                    is not None
                ]
                await _sync(client, auth, batch)
                closed = await client.post(
                    f"/v1/sessions/{plan.json()['id']}/complete", headers=auth
                )
                lesson_done = closed.status_code == 200
                lesson_note = f"complete {closed.status_code}"

            # 3. Unit 1 tested out
            batch = [
                r
                for k, item_id in enumerate(form["item_ids"])
                if (
                    r := _record(
                        catalog.items[item_id],
                        form["checkpoint_id"],
                        now + timedelta(minutes=10, seconds=k),
                    )
                )
                is not None
            ]
            await _sync(client, auth, batch)
            tested = (
                await client.post(
                    f"/v1/assessment/checkpoints/{form['checkpoint_id']}/complete", headers=auth
                )
            ).json()

            due = (await client.get("/v1/reviews/due", headers=auth)).json()
            return {
                "demo": DEMO_EMAIL,
                "created": True,
                "unit_tested_out": bool(tested.get("passed")),
                "lesson_played": lesson_done,
                "lesson_note": lesson_note,
                "reviews_due_now": due.get("total_due"),
            }


def main(argv: list[str]) -> int:  # noqa: ARG001 — no options
    try:
        settings = load_settings(Settings)
    except ConfigError as exc:
        sys.stderr.write(f"{exc}\n")
        return 78
    if settings.env == "prod":
        sys.stderr.write("refusing to create a demo learner with LEP_ENV=prod\n")
        return 2
    password = _password()
    if not password:
        sys.stderr.write(
            "set LEP_DEMO_PASSWORD, or run `make secrets` for the lep_demo_password file\n"
        )
        return 78
    print(json.dumps(asyncio.run(seed(settings, password))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
