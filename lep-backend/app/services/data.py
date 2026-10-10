"""The learner's data controls (docs/11 §10; backend brief §10.3).

* **Export everything** — every row of every table that belongs to the learner, as JSON, with
  voice recordings included as base64. Secrets are left out: the password hash, refresh-token
  and session hashes.
* **Delete recordings only** — ``app.services.speech.delete_recordings``.
* **Pause data collection** — a setting; while on, no recordings or writing are accepted.
* **Delete everything** — after the password is confirmed, the learner row goes and every table
  that refers to it follows (``ON DELETE CASCADE``). The append-only review tables allow it only
  inside a transaction that declares an erasure (``lep.erasure``), which is exactly this one.
  Recording tombstones (an id, a time and a reason — no content) stay as proof of deletion.
"""

from __future__ import annotations

import base64
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final
from uuid import UUID

from sqlalchemy import Table, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Base
from app.models.learner import Learner
from app.services.speech import all_recordings

#: never exported: credentials and token material
SECRET_COLUMNS: Final = frozenset({"password_hash", "token_hash", "family_id_hash"})
SKIPPED_TABLES: Final = frozenset({"auth_sessions", "refresh_tokens", "password_reset_tokens"})


def _plain(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes):
        return base64.b64encode(value).decode()
    return value


def _learner_tables() -> list[Table]:
    return [
        t
        for t in Base.metadata.sorted_tables
        if "learner_id" in t.c and t.name not in SKIPPED_TABLES
    ]


async def export(session: AsyncSession, learner_id: UUID, now: datetime) -> dict[str, Any]:
    learner = await session.get(Learner, learner_id)
    if learner is None:
        return {}
    out: dict[str, Any] = {
        "learner": {
            c.name: _plain(getattr(learner, c.key))
            for c in Learner.__table__.columns
            if c.name not in SECRET_COLUMNS
        }
    }
    for table in _learner_tables():
        query = select(table).where(table.c.learner_id == learner_id)
        if table.name == "recordings":
            # past its expiry a recording is gone, even before the nightly purge runs
            query = query.where(table.c.expires_at > now)
        rows = await session.execute(query)
        out[table.name] = [
            {k: _plain(v) for k, v in r._mapping.items() if k not in SECRET_COLUMNS} for r in rows
        ]
    out["recordings_note"] = (
        "Recordings are kept at most 30 days and are never used for training without your "
        "separate opt-in."
    )
    out["recording_count"] = len(await all_recordings(session, learner_id, now))
    return out


async def delete_account(session: AsyncSession, learner_id: UUID, now: datetime) -> None:
    """Run inside the caller's transaction, after the password has been confirmed."""
    from app.services.speech import delete_recordings

    await delete_recordings(session, learner_id, now, reason="account")
    await session.execute(text("SET LOCAL lep.erasure = 'on'"))
    learner = await session.get(Learner, learner_id)
    if learner is not None:
        await session.delete(learner)
    await session.flush()
