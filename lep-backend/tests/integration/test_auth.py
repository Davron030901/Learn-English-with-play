"""Registration, sign-in and the authenticated caller, end to end."""

from __future__ import annotations

import httpx
import pytest

from app.config import Settings
from tests.factories import PASSWORD
from tests.integration.api import bearer, login, me, register, signed_up
from tests.integration.conftest import Database, settings_for, start_app

pytestmark = pytest.mark.integration


async def test_register_creates_an_account_and_signs_it_in(client: httpx.AsyncClient) -> None:
    response = await register(client, spelling_variant="uk", daily_goal_min=20)

    assert response.status_code == 201
    assert response.headers["location"] == "/v1/me"
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    learner = body["learner"]
    assert learner["l1"] == "uz"
    assert learner["tz"] == "Asia/Tashkent"
    assert learner["daily_goal_min"] == 20
    assert learner["is_minor"] is False
    assert learner["status"] == "active"
    # nobody else sees anything of a new account: no name until the learner picks one
    assert learner["display_name"] is None
    assert learner["settings"] == {
        "desired_retention": 0.9,
        "rest_days": [],
        # leagues are off until the learner joins (docs/10 §6); everyone starts at tier 1
        "leagues_opt_in": False,
        "league_tier": 1,
        "perfectionist_mode": False,
        "data_collection_paused": False,
        "spelling_variant": "uk",
        # voice recording and training use are opt-in, never on by default (docs/11 §10)
        "voice_consent": False,
        "training_opt_in": False,
        # the accessibility profile is the learner's to set; nothing is assumed
        "a11y_no_audio": False,
        "a11y_no_vision": False,
    }
    tokens = body["tokens"]
    assert tokens["token_type"] == "bearer"
    assert 0 < tokens["expires_in"] <= 900
    assert tokens["refresh_token"].startswith("lep_rt_")

    profile = await me(client, tokens["access_token"])
    assert profile.status_code == 200
    assert profile.json() == learner


async def test_register_protects_a_learner_who_might_be_under_18(
    client: httpx.AsyncClient,
) -> None:
    account = await signed_up(client, birth_year=2008)
    assert (await me(client, account.access_token)).json()["is_minor"] is True


async def test_register_refuses_a_learner_who_might_be_under_13(
    client: httpx.AsyncClient, database: Database
) -> None:
    response = await register(client, birth_year=2013)

    assert response.status_code == 422
    assert response.json()["type"] == "age_requirement_not_met"
    connection = await database.connect()
    try:
        assert await connection.fetchval("SELECT count(*) FROM learners") == 0
    finally:
        await connection.close()


async def test_register_refuses_a_birth_year_in_the_future(client: httpx.AsyncClient) -> None:
    response = await register(client, birth_year=2099)
    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "birth_year"


async def test_register_rejects_a_duplicate_email_in_any_case(client: httpx.AsyncClient) -> None:
    account = await signed_up(client)
    duplicate = await register(client, email=account.email.upper())
    assert duplicate.status_code == 409
    assert duplicate.json()["type"] == "email_taken"


async def test_register_rejects_an_unsupported_first_language(client: httpx.AsyncClient) -> None:
    response = await register(client, l1="kk")
    assert response.status_code == 422
    errors = response.json()["errors"]
    assert errors[0]["field"] == "l1"
    assert "uz, ru" in errors[0]["message"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("email", "not-an-email"),
        ("password", "short"),
        ("tz", "Mars/Olympus_Mons"),
        ("l1", "Uzbek"),
        ("daily_goal_min", 7),
        ("spelling_variant", "au"),
        ("birth_year", 1850),
    ],
)
async def test_register_validates_each_field(
    client: httpx.AsyncClient, field: str, value: object
) -> None:
    response = await register(client, **{field: value})
    assert response.status_code == 422
    assert field in [error["field"] for error in response.json()["errors"]]


async def test_register_never_echoes_a_rejected_password(client: httpx.AsyncClient) -> None:
    response = await register(client, password="Tiny-P4ss")
    assert response.status_code == 422
    assert "Tiny-P4ss" not in response.text


async def test_register_rejects_unknown_fields(client: httpx.AsyncClient) -> None:
    response = await register(client, is_admin=True)
    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "is_admin"


async def test_passwords_are_stored_only_as_argon2id_hashes(
    client: httpx.AsyncClient, database: Database
) -> None:
    account = await signed_up(client)
    connection = await database.connect()
    try:
        stored = await connection.fetchval(
            "SELECT password_hash FROM learners WHERE email = $1", account.email
        )
    finally:
        await connection.close()
    assert stored.startswith("$argon2id$")
    assert PASSWORD not in stored


async def test_a_password_with_surrounding_spaces_signs_in_exactly_as_registered(
    client: httpx.AsyncClient,
) -> None:
    spaced = "  pass phrase with spaces 123  "
    account = await signed_up(client, password=spaced)
    assert (await login(client, account.email, spaced)).status_code == 200
    assert (await login(client, account.email, spaced.strip())).status_code == 401


async def test_login_finds_the_account_under_the_registered_normalisation(
    client: httpx.AsyncClient,
) -> None:
    account = await signed_up(client)
    response = await login(client, f"  {account.email.upper()}  ", account.password)
    assert response.status_code == 200


async def test_login_accepts_the_email_in_any_case(client: httpx.AsyncClient) -> None:
    account = await signed_up(client)
    response = await login(client, account.email.upper(), account.password)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    body = response.json()
    assert set(body) == {
        "access_token",
        "token_type",
        "expires_in",
        "refresh_token",
        "refresh_expires_in",
    }
    assert (await me(client, body["access_token"])).status_code == 200


async def test_login_failures_do_not_reveal_whether_the_email_exists(
    client: httpx.AsyncClient,
) -> None:
    account = await signed_up(client)
    wrong_password = await login(client, account.email, "definitely wrong password")
    unknown_email = await login(client, "nobody-here@example.com", "definitely wrong password")

    def comparable(response: httpx.Response) -> dict[str, object]:
        body = dict(response.json())
        body.pop("request_id")
        return body

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert comparable(wrong_password) == comparable(unknown_email)
    assert wrong_password.json()["type"] == "invalid_credentials"
    assert wrong_password.headers["www-authenticate"] == "Bearer"


async def test_login_upgrades_a_hash_made_with_older_parameters(
    settings: Settings, database: Database
) -> None:
    async with start_app(settings) as old:
        account = await signed_up(old.client)
    stronger = settings_for(database, argon2_time_cost=2)
    async with start_app(stronger) as new:
        response = await login(new.client, account.email, account.password)
    assert response.status_code == 200
    connection = await database.connect()
    try:
        stored = await connection.fetchval(
            "SELECT password_hash FROM learners WHERE email = $1", account.email
        )
    finally:
        await connection.close()
    assert ",t=2," in stored


async def test_me_requires_a_bearer_token(client: httpx.AsyncClient) -> None:
    missing = await client.get("/v1/me")
    assert missing.status_code == 401
    assert missing.json()["type"] == "unauthorized"
    assert missing.headers["www-authenticate"] == "Bearer"

    garbage = await client.get("/v1/me", headers=bearer("not.a.jwt"))
    assert garbage.status_code == 401
    assert garbage.json()["type"] == "invalid_token"
    assert 'error="invalid_token"' in garbage.headers["www-authenticate"]


async def test_login_form_uses_the_oauth2_password_grant(client: httpx.AsyncClient) -> None:
    account = await signed_up(client)
    wrong_grant = await client.post(
        "/v1/auth/login",
        data={"grant_type": "client_credentials", "username": account.email, "password": "x"},
    )
    assert wrong_grant.status_code == 422
    as_json = await client.post(
        "/v1/auth/login", json={"username": account.email, "password": account.password}
    )
    assert as_json.status_code == 422
