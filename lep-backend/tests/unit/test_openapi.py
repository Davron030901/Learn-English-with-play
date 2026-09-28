from __future__ import annotations

from pathlib import Path
from typing import Any

from app.errors import PROBLEM_MEDIA_TYPE
from scripts.export_openapi import openapi_document, render

ROOT = Path(__file__).resolve().parents[2]


def test_the_committed_openapi_json_is_current() -> None:
    committed = (ROOT / "openapi.json").read_text(encoding="utf-8")
    assert committed == render(openapi_document()), "openapi.json is stale: run `make openapi`"


def test_error_responses_are_documented_as_problem_documents() -> None:
    document: dict[str, Any] = openapi_document()
    error_media_types = set()
    for path_item in document["paths"].values():
        for operation in path_item.values():
            for status, response in operation["responses"].items():
                if int(status) >= 400:
                    error_media_types.update(response.get("content", {}))
    assert error_media_types == {PROBLEM_MEDIA_TYPE}
    assert "HTTPValidationError" not in document["components"]["schemas"]


def test_the_public_contract_has_the_phase_1_routes() -> None:
    paths = set(openapi_document()["paths"])
    assert {
        "/health",
        "/ready",
        "/v1/auth/register",
        "/v1/auth/login",
        "/v1/auth/refresh",
        "/v1/auth/logout",
        "/v1/me",
    } <= paths
    assert "/metrics" not in paths
