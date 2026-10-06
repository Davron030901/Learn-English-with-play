"""GET /v1/course, GET /v1/units/{unit_id} and GET /v1/content/bundle — the course, as the app
ships it, and the manifest of its files for offline use.

Public and cacheable: the content holds no learner data, so a CDN may cache it. Every response
carries a strong ETag scoped to the content version; a matching ``If-None-Match`` gets 304.
"""

from __future__ import annotations

import hashlib
from typing import Annotated

from fastapi import APIRouter, Path, Query, Request, Response

from app.content.bundle import manifest
from app.deps import ContainerDep
from app.errors import NotFound
from app.schemas.content import CourseOut, UnitOut
from app.schemas.problem import problem_responses
from app.schemas.sync import BundleFileOut, ContentBundleOut

router = APIRouter(tags=["content"])

#: Clients revalidate after five minutes; the ETag makes that a cheap 304.
CACHE_CONTROL = "public, max-age=300, must-revalidate"


def _matches(request: Request, etag: str) -> bool:
    header = request.headers.get("if-none-match")
    if not header:
        return False
    candidates = {c.strip().removeprefix("W/") for c in header.split(",")}
    return "*" in candidates or etag in candidates


def _send_body(request: Request, body: bytes) -> Response:
    return _send(request, body, f'"sha256:{hashlib.sha256(body).hexdigest()[:32]}"')


def _send(request: Request, body: bytes, etag: str) -> Response:
    headers = {"ETag": etag, "Cache-Control": CACHE_CONTROL}
    if _matches(request, etag):
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


@router.get(
    "/course",
    summary="The course map: sections, units and nodes (no items)",
    response_model=CourseOut,
    responses={**problem_responses(429), 304: {"description": "Not modified"}},
)
async def get_course(request: Request, container: ContainerDep) -> Response:
    catalog = container.content
    return _send(request, catalog.course_json(), catalog.etag("course"))


@router.get(
    "/units/{unit_id}",
    summary="One unit: nodes with their items, vocabulary, grammar, story",
    response_model=UnitOut,
    responses={**problem_responses(404, 429), 304: {"description": "Not modified"}},
)
async def get_unit(
    request: Request,
    container: ContainerDep,
    unit_id: Annotated[str, Path(pattern=r"^S\d{2}U\d{2}$", examples=["S05U12"])],
) -> Response:
    catalog = container.content
    body = catalog.unit_json(unit_id)
    if body is None:
        raise NotFound(f"There is no unit {unit_id}.")
    return _send(request, body, catalog.etag(unit_id))


@router.get(
    "/content/bundle",
    summary="Every content file with its SHA-256 and URL (docs/11 §3), or nothing when unchanged",
    response_model=ContentBundleOut,
    responses={**problem_responses(422, 429), 304: {"description": "Not modified"}},
)
async def get_content_bundle(
    request: Request,
    container: ContainerDep,
    since: Annotated[
        str | None,
        Query(max_length=64, description="The content version the device holds; omit for all."),
    ] = None,
) -> Response:
    catalog = container.content
    if since == catalog.version:
        out = ContentBundleOut(
            content_version=catalog.version, unchanged=True, course=None, units=[]
        )
        return _send_body(request, out.model_dump_json().encode())
    cdn = container.settings.content_cdn_base_url
    listing = manifest(catalog, cdn)
    out = ContentBundleOut(
        content_version=catalog.version,
        unchanged=False,
        course=BundleFileOut(**listing["course"]),
        units=[BundleFileOut(**u) for u in listing["units"]],
    )
    # the ETag is the body's own hash: moving the CDN (or falling back to the API) or a release
    # that serialises content differently is never answered with 304 and the old manifest
    return _send_body(request, out.model_dump_json().encode())
