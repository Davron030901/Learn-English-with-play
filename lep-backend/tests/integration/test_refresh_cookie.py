"""The web's refresh token as an httpOnly cookie (frontend DECISIONS F8)."""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest

from app.api.v1.auth import REFRESH_COOKIE
from app.main import build_app
from tests.factories import OffsetClock, registration
from tests.integration.conftest import Database, settings_for

pytestmark = pytest.mark.integration

APP_ORIGIN = "https://app.example.org"
WEB = {"X-LEP-Token-Transport": "cookie", "Origin": APP_ORIGIN}


async def _client(
    database: Database, clock: OffsetClock, **overrides: object
) -> AsyncIterator[httpx.AsyncClient]:
    settings = settings_for(database, cors_origins=[APP_ORIGIN], **overrides)
    application = build_app(settings, clock=clock)
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application, client=("127.0.0.1", 50_000))
        # https, so the client's cookie jar sends the Secure cookie back
        async with httpx.AsyncClient(transport=transport, base_url="https://api.test") as c:
            yield c


@pytest.fixture
async def web(database: Database, clock: OffsetClock) -> AsyncIterator[httpx.AsyncClient]:
    async for c in _client(database, clock, web_refresh_cookie=True):
        yield c


def _set_cookie(response: httpx.Response) -> str:
    headers = [v for k, v in response.headers.multi_items() if k == "set-cookie"]
    assert len(headers) == 1, headers
    return headers[0]


async def test_the_refresh_token_lives_in_an_httponly_cookie(web: httpx.AsyncClient) -> None:
    signed = await web.post("/v1/auth/register", json=registration(), headers=WEB)
    assert signed.status_code == 201, signed.text
    assert signed.json()["tokens"]["refresh_token"] is None, "never readable by script"
    cookie = _set_cookie(signed).lower()
    assert cookie.startswith(REFRESH_COOKIE.lower() + "=")
    for attribute in ("httponly", "secure", "samesite=strict", "path=/;", "max-age="):
        assert attribute in cookie, attribute
    first = web.cookies.get(REFRESH_COOKIE)
    assert first

    rotated = await web.post("/v1/auth/refresh", headers=WEB)
    assert rotated.status_code == 200, rotated.text
    assert rotated.json()["refresh_token"] is None
    assert rotated.json()["access_token"]
    assert web.cookies.get(REFRESH_COOKIE) not in (None, first), "rotated"

    # the old cookie replayed is reuse: the session ends for every holder
    replayed = await web.post(
        "/v1/auth/refresh", headers={**WEB, "Cookie": f"{REFRESH_COOKIE}={first}"}
    )
    assert replayed.status_code == 401
    assert replayed.json()["type"] == "session_revoked"


async def test_logout_clears_the_cookie_and_ends_the_session(web: httpx.AsyncClient) -> None:
    await web.post("/v1/auth/register", json=registration(), headers=WEB)
    held = web.cookies.get(REFRESH_COOKIE)
    out = await web.post("/v1/auth/logout", headers=WEB)
    assert out.status_code == 204
    assert "max-age=0" in _set_cookie(out).lower()
    after = await web.post(
        "/v1/auth/refresh", headers={**WEB, "Cookie": f"{REFRESH_COOKIE}={held}"}
    )
    assert after.status_code == 401
    # a browser that holds no session can still sign out, harmlessly
    web.cookies.clear()
    assert (await web.post("/v1/auth/logout", headers=WEB)).status_code == 204


async def test_a_foreign_origin_and_a_missing_header_get_nothing(web: httpx.AsyncClient) -> None:
    await web.post("/v1/auth/register", json=registration(), headers=WEB)
    foreign = await web.post(
        "/v1/auth/refresh",
        headers={"X-LEP-Token-Transport": "cookie", "Origin": "https://evil.example"},
    )
    assert foreign.status_code == 403
    assert foreign.json()["type"] == "origin_refused"
    # without the header the cookie is never read (a form cannot send the header)
    bare = await web.post("/v1/auth/refresh")
    assert bare.status_code == 422
    # the API's own origin is fine
    own = await web.post(
        "/v1/auth/refresh",
        headers={"X-LEP-Token-Transport": "cookie", "Origin": "https://api.test"},
    )
    assert own.status_code == 200, own.text


async def test_the_native_body_flow_is_unchanged(web: httpx.AsyncClient) -> None:
    signed = await web.post("/v1/auth/register", json=registration())
    tokens = signed.json()["tokens"]
    assert tokens["refresh_token"], "no header: the token is in the body as before"
    assert "set-cookie" not in signed.headers
    rotated = await web.post("/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert rotated.status_code == 200
    assert rotated.json()["refresh_token"]


async def test_cors_allows_credentials_only_for_the_cookie(web: httpx.AsyncClient) -> None:
    preflight = await web.options(
        "/v1/auth/refresh",
        headers={
            "Origin": APP_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-lep-token-transport, content-type",
        },
    )
    assert preflight.status_code == 200, preflight.text
    assert preflight.headers["access-control-allow-credentials"] == "true"
    assert "x-lep-token-transport" in preflight.headers["access-control-allow-headers"].lower()


async def test_with_the_cookie_off_the_header_changes_nothing(
    database: Database, clock: OffsetClock
) -> None:
    async for c in _client(database, clock):
        signed = await c.post("/v1/auth/register", json=registration(), headers=WEB)
        assert signed.json()["tokens"]["refresh_token"], "falls back to the body"
        assert "set-cookie" not in signed.headers
        preflight = await c.options(
            "/v1/auth/refresh",
            headers={"Origin": APP_ORIGIN, "Access-Control-Request-Method": "POST"},
        )
        assert "access-control-allow-credentials" not in preflight.headers
