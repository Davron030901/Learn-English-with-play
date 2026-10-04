"""GET /v1/course and GET /v1/units/{unit_id} — the course, as the app ships it.

Public and cacheable: the content holds no learner data, so a CDN may cache it. Every response
carries a strong ETag scoped to the content version; a matching ``If-None-Match`` gets 304.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Request, Response

from app.deps import ContainerDep
from app.errors import NotFound
from app.schemas.content import CourseOut, UnitOut
from app.schemas.problem import problem_responses

router = APIRouter(tags=["content"])

#: Clients revalidate after five minutes; the ETag makes that a cheap 304.
CACHE_CONTROL = "public, max-age=300, must-revalidate"


def _matches(request: Request, etag: str) -> bool:
    header = request.headers.get("if-none-match")
    if not header:
        return False
    candidates = {c.strip().removeprefix("W/") for c in header.split(",")}
    return "*" in candidates or etag in candidates


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
