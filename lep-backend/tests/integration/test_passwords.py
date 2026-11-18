"""Forgotten and changed passwords (frontend DECISIONS B5), and the new-password screen (R14)."""

from __future__ import annotations

import email
import re
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from email.message import Message
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from tests.factories import OffsetClock
from tests.integration.api import bearer, login, me, refresh, signed_up
from tests.integration.conftest import Database, settings_for, start_app

pytestmark = pytest.mark.integration

RESET_URL = "https://app.example.org/reset-password"
NEW_PASSWORD = "a quiet morning in samarkand"


@pytest.fixture
def outbox(tmp_path: Path) -> Path:
    return tmp_path / "mail"


@pytest.fixture
async def mailing(
    database: Database, outbox: Path, clock: OffsetClock
) -> AsyncIterator[httpx.AsyncClient]:
    settings = settings_for(
        database,
        mail_backend="file",
        mail_outbox_dir=outbox,
        mail_from="Learn English <no-reply@example.org>",
        password_reset_url=RESET_URL,
    )
    async with start_app(settings, clock=clock) as running:
        yield running.client


def letters(outbox: Path) -> list[Message]:
    if not outbox.exists():
        return []
    return [email.message_from_bytes(p.read_bytes()) for p in sorted(outbox.glob("*.eml"))]


def token_in(message: Message) -> str:
    body = message.get_payload(decode=True)
    assert isinstance(body, bytes)
    found = re.search(re.escape(RESET_URL) + r"\?token=([A-Za-z0-9_-]+)", body.decode())
    assert found, body
    return found.group(1)


async def forgot(client: httpx.AsyncClient, address: str) -> httpx.Response:
    return await client.post("/v1/auth/password/forgot", json={"email": address})


async def reset(client: httpx.AsyncClient, token: str, password: str) -> httpx.Response:
    return await client.post(
        "/v1/auth/password/reset", json={"token": token, "new_password": password}
    )


async def test_the_answer_is_the_same_for_any_address_and_the_link_works_once(
    mailing: httpx.AsyncClient, outbox: Path
) -> None:
    account = await signed_up(mailing)
    known = await forgot(mailing, account.email.upper())
    unknown = await forgot(mailing, "nobody-here@example.com")
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert known.json()["expires_in_minutes"] == 30

    sent = letters(outbox)
    assert len(sent) == 1, "only the address with an account gets a letter"
    letter = sent[0]
    assert letter["To"] == account.email
    assert letter["Subject"] == "Learn English with Play parolini tiklash", "the learner's L1"
    text = letter.get_payload(decode=True)
    assert isinstance(text, bytes)
    assert "Someone asked to reset the password" in text.decode(), "and English after it"
    token = token_in(letter)

    done = await reset(mailing, token, NEW_PASSWORD)
    assert done.status_code == 204, done.text

    # every session ended: the old tokens no longer work
    assert (await me(mailing, account.access_token)).status_code == 401
    assert (await refresh(mailing, account.refresh_token)).status_code == 401
    assert (await login(mailing, account.email, account.password)).status_code == 401
    assert (await login(mailing, account.email, NEW_PASSWORD)).status_code == 200

    again = await reset(mailing, token, "another fine passphrase")
    assert again.status_code == 400
    assert again.json()["type"] == "reset_link_invalid"


async def test_a_newer_link_voids_the_older_and_a_link_expires(
    mailing: httpx.AsyncClient, outbox: Path, clock: OffsetClock
) -> None:
    account = await signed_up(mailing)
    await forgot(mailing, account.email)
    await forgot(mailing, account.email)
    first, second = (token_in(m) for m in letters(outbox))
    assert (await reset(mailing, first, NEW_PASSWORD)).json()["type"] == "reset_link_invalid"

    clock.advance(timedelta(minutes=31))
    late = await reset(mailing, second, NEW_PASSWORD)
    assert late.status_code == 400
    assert late.json()["type"] == "reset_link_invalid"
    assert (await login(mailing, account.email, account.password)).status_code == 200


async def test_a_weak_new_password_is_refused_and_the_link_still_works(
    mailing: httpx.AsyncClient, outbox: Path
) -> None:
    account = await signed_up(mailing)
    await forgot(mailing, account.email)
    token = token_in(letters(outbox)[0])
    for weak, reason in (
        ("password1234", "common"),
        ("qwertyuiop12", "common"),
        ("aaaaaaaaaaaa", "pattern"),
        ("abcdefghijkl", "pattern"),
    ):
        refused = await reset(mailing, token, weak)
        assert refused.status_code == 422, weak
        assert (refused.json()["type"], refused.json()["reason"]) == ("password_refused", reason)
        assert refused.json()["errors"][0]["field"] == "new_password"
        assert weak not in refused.text, "the password is never echoed"
    built_from_email = account.email.partition("@")[0] + "123"
    refused = await reset(mailing, token, built_from_email)
    assert refused.status_code == 422
    assert refused.json()["reason"] == "context"
    assert (await reset(mailing, token, NEW_PASSWORD)).status_code == 204


async def test_garbage_tokens_and_bodies(mailing: httpx.AsyncClient) -> None:
    assert (await reset(mailing, "x" * 43, NEW_PASSWORD)).status_code == 400
    assert (await reset(mailing, "short", NEW_PASSWORD)).status_code == 422
    assert (await reset(mailing, "x" * 43, "tiny")).status_code == 422
    extra = await mailing.post(
        "/v1/auth/password/forgot", json={"email": "a@example.com", "name": "x"}
    )
    assert extra.status_code == 422


async def test_without_a_mail_backend_the_feature_says_so(client: httpx.AsyncClient) -> None:
    r = await forgot(client, "anyone@example.com")
    assert r.status_code == 503
    assert r.json()["type"] == "password_reset_unavailable"


async def test_requests_for_one_address_are_limited(
    database: Database, outbox: Path, clock: OffsetClock
) -> None:
    settings = settings_for(
        database,
        mail_backend="file",
        mail_outbox_dir=outbox,
        mail_from="no-reply@example.org",
        password_reset_url=RESET_URL,
        rate_limit_password_reset_account_per_hour=2,
    )
    async with start_app(settings, clock=clock) as running:
        for _ in range(2):
            assert (await forgot(running.client, "someone@example.com")).status_code == 202
        limited = await forgot(running.client, "SOMEONE@example.com")
        assert limited.status_code == 429
        assert (await forgot(running.client, "someone.else@example.com")).status_code == 202


async def test_registration_refuses_a_common_password(client: httpx.AsyncClient) -> None:
    from tests.integration.api import register

    r = await register(client, password="password1234")
    assert r.status_code == 422
    assert (r.json()["type"], r.json()["reason"]) == ("password_refused", "common")
    assert r.json()["errors"][0]["field"] == "password"


# ------------------------------------------------------------------- changing it, signed in


async def change(
    client: httpx.AsyncClient, access_token: str, current: str, new: str
) -> httpx.Response:
    return await client.post(
        "/v1/me/password",
        json={"current_password": current, "new_password": new},
        headers=bearer(access_token),
    )


async def test_changing_the_password_ends_the_other_devices_sessions(
    client: httpx.AsyncClient,
) -> None:
    account = await signed_up(client)
    other = (await login(client, account.email, account.password)).json()

    wrong = await change(client, account.access_token, "not my password", NEW_PASSWORD)
    assert wrong.status_code == 422
    assert wrong.json()["errors"][0]["field"] == "current_password"
    same = await change(client, account.access_token, account.password, account.password)
    assert same.status_code == 422
    assert same.json()["reason"] == "unchanged"
    weak = await change(client, account.access_token, account.password, "password1234")
    assert weak.status_code == 422
    assert weak.json()["errors"][0]["field"] == "new_password"

    done = await change(client, account.access_token, account.password, NEW_PASSWORD)
    assert done.status_code == 204, done.text
    assert (await me(client, account.access_token)).status_code == 200, "this device stays"
    assert (await refresh(client, account.refresh_token)).status_code == 200
    assert (await me(client, other["access_token"])).status_code == 401, "the other ends"
    assert (await refresh(client, other["refresh_token"])).status_code == 401
    assert (await login(client, account.email, NEW_PASSWORD)).status_code == 200
    assert (await login(client, account.email, account.password)).status_code == 401


async def test_changing_needs_a_session(client: httpx.AsyncClient) -> None:
    r = await client.post(
        "/v1/me/password", json={"current_password": "x", "new_password": NEW_PASSWORD}
    )
    assert r.status_code == 401


async def test_a_sign_in_that_raced_a_password_change_is_refused(
    app: FastAPI, client: httpx.AsyncClient, database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The password is replaced while sign-in's Argon2 runs: no session for the old one."""
    account = await signed_up(client)
    hasher = app.state.container.hasher
    real_verify = hasher.verify

    async def verify_then_replace(password_hash: str | None, password: object) -> bool:
        ok: bool = await real_verify(password_hash, password)
        conn = await database.connect()
        try:
            await conn.execute(
                "UPDATE learners SET password_hash = 'replaced-meanwhile' WHERE id = $1",
                uuid.UUID(account.learner_id),
            )
        finally:
            await conn.close()
        return ok

    monkeypatch.setattr(hasher, "verify", verify_then_replace)
    raced = await login(client, account.email, account.password)
    assert raced.status_code == 401
    assert raced.json()["type"] == "invalid_credentials"


async def test_the_data_export_leaves_reset_links_out_like_sessions(
    mailing: httpx.AsyncClient, outbox: Path
) -> None:
    account = await signed_up(mailing)
    await forgot(mailing, account.email)
    assert letters(outbox), "a link exists"
    export = (await mailing.get("/v1/me/export", headers=bearer(account.access_token))).json()
    assert "password_reset_tokens" not in export
    assert "auth_sessions" not in export
