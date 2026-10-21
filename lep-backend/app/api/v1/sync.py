"""GET /v1/sync/bundle — what to hold offline (backend brief §11, Phase 9)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.deps import ContainerDep, CurrentPrincipal, DbSession
from app.errors import InvalidToken
from app.repositories.learners import LearnerRepository
from app.schemas.problem import problem_responses
from app.schemas.sync import BundleFileOut, DueStateOut, SyncBundleOut
from app.services.sessions import saved_profile
from app.services.sync import sync_bundle

router = APIRouter(tags=["sync"])


@router.get(
    "/sync/bundle",
    summary="The next five units (with hashes) and the reviews due in the next seven days",
    responses=problem_responses(401, 422, 429, 503),
)
async def get_sync_bundle(
    principal: CurrentPrincipal,
    session: DbSession,
    container: ContainerDep,
    since: Annotated[
        str | None,
        Query(
            max_length=64,
            description="The content version the device holds (`content_version` of its last "
            "bundle or course); omit on first sync.",
        ),
    ] = None,
) -> SyncBundleOut:
    now = container.clock.now()
    async with session.begin():
        profile = await LearnerRepository(session).profile(principal.learner_id)
        if profile is None:
            raise InvalidToken("This account no longer exists.")
        bundle = await sync_bundle(
            session,
            container.content,
            principal.learner_id,
            now,
            since,
            container.settings.content_cdn_base_url,
            saved_profile(profile),
        )
    return SyncBundleOut(
        as_of=bundle.as_of,
        content_version=bundle.content_version,
        content_changed=bundle.content_changed,
        current_unit=bundle.current_unit,
        units=[
            BundleFileOut(id=f.id, sha256=f.sha256, bytes=f.bytes, url=f.url) for f in bundle.units
        ],
        due=[
            DueStateOut(
                memory_item_id=e.state.memory_item_id,
                item_id=e.item_id,
                due_at=e.state.due,
                state=e.state.state,
            )
            for e in bundle.due
        ],
        due_total=bundle.due_total,
        window_days=bundle.window_days,
    )
