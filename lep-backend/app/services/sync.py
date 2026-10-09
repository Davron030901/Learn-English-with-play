"""A learner's sync bundle: what the device should hold to keep learning offline.

Backend brief §11 and docs/00 §6: the client holds the next five units of content and the next
seven days of scheduled reviews. ``GET /v1/sync/bundle?since=<content version>`` names both —
the units with their hashes (so only what changed is downloaded) and the memory items due in
the window, each with the exercise to review it by (so the device can water the garden
offline exactly as the server would have asked). Answers given offline come back through ``POST /v1/sync/reviews`` with their true
timestamps; the server re-derives every state from the log, so the due dates here are only
what the device schedules by until then.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.bundle import BundleFile, bundle_file
from app.content.catalog import ContentCatalog
from app.domain.accessibility import NO_PROFILE, A11yProfile
from app.models.review import MemoryState
from app.services.progress import ProgressService

WINDOW_DAYS: Final = 7
WINDOW_UNITS: Final = 5
#: a device needs the soonest reviews first; the total says how many more there are
MAX_DUE: Final = 5_000
_IDLE: Final = ("suspended", "retired")


@dataclass(frozen=True, slots=True)
class SyncBundle:
    as_of: datetime
    content_version: str
    content_changed: bool
    current_unit: str
    units: list[BundleFile]
    due: list[DueEntry]
    due_total: int
    window_days: int


@dataclass(frozen=True, slots=True)
class DueEntry:
    state: MemoryState
    #: an exercise that reviews it, chosen as for the online queue (None when no item does)
    item_id: str | None


async def sync_bundle(
    session: AsyncSession,
    catalog: ContentCatalog,
    learner_id: UUID,
    now: datetime,
    since: str | None,
    cdn_base_url: str | None,
    a11y: A11yProfile = NO_PROFILE,
) -> SyncBundle:
    progress = ProgressService(session, catalog)
    tiers, done = await progress.path(learner_id)
    current = progress.current_unit(tiers, done)
    order = catalog.unit_order()
    here = order.index(current)
    window = list(order[here : here + WINDOW_UNITS])
    until = now + timedelta(days=WINDOW_DAYS)
    in_window = (
        MemoryState.learner_id == learner_id,
        MemoryState.due <= until,
        MemoryState.state.not_in(_IDLE),
    )
    total = int((await session.execute(select(func.count()).where(*in_window))).scalar_one())
    due = list(
        (
            await session.execute(
                select(MemoryState)
                .where(*in_window)
                .order_by(MemoryState.due, MemoryState.memory_item_id)
                .limit(MAX_DUE)
            )
        ).scalars()
    )
    # each review gets the exercise the device will show offline, chosen as the online queue
    # chooses it but from the units the learner has reached (up to the end of the window), so
    # nothing later in the course is spoiled; the bundle names the units those exercises are in
    reached = frozenset(order[: here + len(window)])
    used: set[str] = set()
    entries: list[DueEntry] = []
    for m in due:
        item_id = progress.review_item(m, used, within=reached, a11y=a11y)
        if item_id is not None:
            used.add(item_id)
        entries.append(DueEntry(m, item_id))
    holding = {catalog.items[e.item_id].unit_id for e in entries if e.item_id is not None}
    extra = [u for u in order if u in holding and u not in window]
    return SyncBundle(
        as_of=now,
        content_version=catalog.version,
        content_changed=since != catalog.version,
        current_unit=current,
        units=[bundle_file(catalog, u, cdn_base_url) for u in window + extra],
        due=entries,
        due_total=total,
        window_days=WINDOW_DAYS,
    )
