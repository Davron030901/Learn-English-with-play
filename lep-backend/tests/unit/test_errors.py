from __future__ import annotations

import errno
from collections.abc import AsyncIterator
from typing import Annotated

import httpx
import pytest
import redis.exceptions
import sqlalchemy.exc
from fastapi import FastAPI, Form
from pydantic import BaseModel, SecretStr

from app.errors import (
    PROBLEM_MEDIA_TYPE,
    EmailAlreadyRegistered,
    RateLimited,
    install_exception_handlers,
    is_dependency_failure,
)


class _Body(BaseModel):
    email: str
    age: int


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    app = FastAPI()
    install_exception_handlers(app)

    @app.post("/json")
    async def json_body(body: _Body) -> dict[str, str]:
        return {"email": body.email}

    @app.post("/form")
    async def form_body(
        username: Annotated[str, Form()],
        password: Annotated[SecretStr, Form(min_length=12)],
    ) -> None:
        return None

    @app.get("/taken")
    async def taken() -> None:
        raise EmailAlreadyRegistered("An account with this email already exists.")

    @app.get("/slow-down")
    async def slow_down() -> None:
        raise RateLimited(retry_after_s=42)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


async def test_domain_errors_render_as_problem_documents(client: httpx.AsyncClient) -> None:
    response = await client.get("/taken")
    assert response.status_code == 409
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json() == {
        "type": "email_taken",
        "title": "Email already registered",
        "status": 409,
        "detail": "An account with this email already exists.",
        "instance": "/taken",
    }


async def test_rate_limit_problems_carry_retry_after(client: httpx.AsyncClient) -> None:
    response = await client.get("/slow-down")
    assert response.status_code == 429
    assert response.headers["retry-after"] == "42"
    assert response.json()["retry_after_s"] == 42


async def test_validation_errors_list_fields_without_echoing_input(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post("/json", json={"email": "a@b.co", "age": "not-a-number"})
    assert response.status_code == 422
    body = response.json()
    assert body["type"] == "validation_error"
    assert body["errors"] == [{"field": "age", "message": body["errors"][0]["message"]}]
    assert "not-a-number" not in response.text


async def test_a_rejected_password_is_never_echoed(client: httpx.AsyncClient) -> None:
    response = await client.post("/form", data={"username": "a@b.co", "password": "tooshort1"})
    assert response.status_code == 422
    assert "tooshort1" not in response.text
    assert response.json()["errors"][0]["field"] == "password"


async def test_unknown_routes_and_methods_are_problems_too(client: httpx.AsyncClient) -> None:
    missing = await client.get("/nowhere")
    assert missing.status_code == 404
    assert missing.json()["type"] == "not_found"
    wrong_method = await client.delete("/taken")
    assert wrong_method.status_code == 405
    assert wrong_method.json()["type"] == "method_not_allowed"
    assert "GET" in wrong_method.headers["allow"]


@pytest.mark.parametrize(
    "exc",
    [
        ConnectionRefusedError(errno.ECONNREFUSED, "refused"),
        TimeoutError(),
        OSError("Multiple exceptions: [Errno 111] Connect call failed"),
        OSError(errno.EHOSTUNREACH, "no route to host"),
        redis.exceptions.ConnectionError("down"),
        sqlalchemy.exc.TimeoutError(),
    ],
)
def test_dependency_failures_are_recognised(exc: Exception) -> None:
    assert is_dependency_failure(exc)


@pytest.mark.parametrize(
    "exc", [ValueError("bug"), KeyError("bug"), FileNotFoundError(errno.ENOENT, "missing")]
)
def test_ordinary_bugs_are_not_dependency_failures(exc: Exception) -> None:
    assert not is_dependency_failure(exc)
