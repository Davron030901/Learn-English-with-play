"""The RFC 9457 problem shape, for the OpenAPI document."""

from __future__ import annotations

from http import HTTPStatus
from typing import Any

from pydantic import BaseModel, ConfigDict


class FieldErrorOut(BaseModel):
    field: str
    message: str


class Problem(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    title: str
    status: int
    detail: str | None = None
    instance: str | None = None
    request_id: str | None = None
    errors: list[FieldErrorOut] | None = None


def problem_responses(*statuses: int) -> dict[int | str, dict[str, Any]]:
    """``responses=`` entries documenting problem bodies for the given status codes."""
    return {
        status: {"model": Problem, "description": HTTPStatus(status).phrase} for status in statuses
    }
