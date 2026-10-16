"""Offline bundles: the content manifest and a learner's sync bundle (Phase 9, docs/11 §3)."""

from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.schemas.gamification import Out


class BundleFileOut(Out):
    id: str = Field(description='"course" or a unit id.')
    sha256: str = Field(description="SHA-256 of the file's bytes: keep a cached copy while equal.")
    bytes: int
    url: str = Field(
        description="Where to fetch it: an immutable CDN URL keyed by the hash, or the API path."
    )


class ContentBundleOut(Out):
    content_version: str
    unchanged: bool = Field(
        description="True when `since` is the current content version: nothing to download."
    )
    course: BundleFileOut | None = Field(description="The course outline; null when unchanged.")
    units: list[BundleFileOut] = Field(
        description="Every unit, in course order; empty when unchanged."
    )


class DueStateOut(Out):
    memory_item_id: str
    item_id: str | None = Field(
        description="An exercise that reviews it (null when no item does), chosen as for "
        "GET /v1/reviews/due but only from units the learner has reached."
    )
    due_at: datetime
    state: str


class SyncBundleOut(Out):
    as_of: datetime
    content_version: str
    content_changed: bool = Field(
        description="False when `since` is the current content version: cached units are current."
    )
    current_unit: str = Field(description="Where the learner is on the path.")
    units: list[BundleFileOut] = Field(
        description="The next five units from the current one, then every other unit the due "
        "window reviews — what the device should hold to learn and review offline."
    )
    due: list[DueStateOut] = Field(
        description="Memory items due within the window, soonest first (at most 5,000), each "
        "with its exercise: offline, the device reviews those whose due_at has passed."
    )
    due_total: int = Field(description="How many are due within the window in all.")
    window_days: int
