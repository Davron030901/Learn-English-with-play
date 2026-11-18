"""Small helpers for driving the API in integration tests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from tests.factories import PASSWORD, registration


@dataclass(frozen=True)
class Account:
    email: str
    password: str
    learner_id: str
    access_token: str
    refresh_token: str


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def register(client: httpx.AsyncClient, **overrides: Any) -> httpx.Response:
    return await client.post("/v1/auth/register", json=registration(**overrides))


async def signed_up(client: httpx.AsyncClient, **overrides: Any) -> Account:
    body = registration(**overrides)
    response = await client.post("/v1/auth/register", json=body)
    assert response.status_code == 201, response.text
    payload = response.json()
    return Account(
        email=body["email"],
        password=body.get("password", PASSWORD),
        learner_id=payload["learner"]["id"],
        access_token=payload["tokens"]["access_token"],
        refresh_token=payload["tokens"]["refresh_token"],
    )


async def login(client: httpx.AsyncClient, email: str, password: str) -> httpx.Response:
    return await client.post(
        "/v1/auth/login",
        data={"grant_type": "password", "username": email, "password": password},
    )


async def refresh(client: httpx.AsyncClient, refresh_token: str) -> httpx.Response:
    return await client.post("/v1/auth/refresh", json={"refresh_token": refresh_token})


async def logout(client: httpx.AsyncClient, refresh_token: str) -> httpx.Response:
    return await client.post("/v1/auth/logout", json={"refresh_token": refresh_token})


async def me(client: httpx.AsyncClient, access_token: str) -> httpx.Response:
    return await client.get("/v1/me", headers=bearer(access_token))
