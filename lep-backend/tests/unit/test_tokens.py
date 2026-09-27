from __future__ import annotations

import base64
import json
import secrets
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from pydantic import SecretStr

from app.errors import InvalidToken
from app.ids import uuid7
from app.security.tokens import (
    ACCESS_TOKEN_TYPE,
    REFRESH_TOKEN_PREFIX,
    TokenService,
    hash_refresh_token,
    key_id,
    new_refresh_token,
)
from tests.factories import FrozenClock


def _key() -> SecretStr:
    return SecretStr(secrets.token_urlsafe(48))


def _service(
    secret: SecretStr, *, previous: SecretStr | None = None, clock: FrozenClock | None = None
) -> TokenService:
    return TokenService(
        secret=secret,
        previous_secret=previous,
        issuer="lep-backend",
        audience="lep-api",
        access_ttl=timedelta(minutes=15),
        clock=clock or FrozenClock(datetime.now(UTC)),
    )


def test_should_round_trip_an_access_token() -> None:
    service = _service(_key())
    learner, session = uuid7(), uuid7()

    issued = service.issue_access_token(learner_id=learner, session_id=session)
    claims = service.verify_access_token(issued.token)

    assert (claims.learner_id, claims.session_id) == (learner, session)
    header = jwt.get_unverified_header(issued.token)
    assert header["alg"] == "HS256"
    assert header["typ"] == ACCESS_TOKEN_TYPE


def test_should_carry_no_personal_data() -> None:
    issued = _service(_key()).issue_access_token(learner_id=uuid7(), session_id=uuid7())
    payload = jwt.decode(issued.token, options={"verify_signature": False})
    assert set(payload) == {"iss", "aud", "sub", "sid", "iat", "nbf", "exp", "jti"}


def test_should_reject_an_expired_token() -> None:
    key = _key()
    past = FrozenClock(datetime.now(UTC) - timedelta(hours=1))
    token = _service(key, clock=past).issue_access_token(learner_id=uuid7(), session_id=uuid7())
    with pytest.raises(InvalidToken, match="expired"):
        _service(key).verify_access_token(token.token)


def test_should_reject_a_token_signed_with_another_key() -> None:
    token = _service(_key()).issue_access_token(learner_id=uuid7(), session_id=uuid7())
    with pytest.raises(InvalidToken):
        _service(_key()).verify_access_token(token.token)


def test_should_accept_tokens_signed_with_the_previous_key_during_rotation() -> None:
    old = _key()
    token = _service(old).issue_access_token(learner_id=uuid7(), session_id=uuid7())
    rotated = _service(_key(), previous=old)
    assert rotated.verify_access_token(token.token).token_id


def test_should_reject_a_tampered_payload() -> None:
    key = _key()
    service = _service(key)
    token = service.issue_access_token(learner_id=uuid7(), session_id=uuid7()).token
    header, payload, signature = token.split(".")
    claims = json.loads(base64.urlsafe_b64decode(payload + "=="))
    claims["sub"] = str(uuid7())
    forged = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    with pytest.raises(InvalidToken):
        service.verify_access_token(f"{header}.{forged}.{signature}")


def test_should_reject_the_none_algorithm() -> None:
    key = _key()
    service = _service(key)
    unsigned = jwt.encode(
        {"sub": str(uuid7()), "sid": str(uuid7())},
        key=None,
        algorithm="none",
        headers={"kid": key_id(key), "typ": ACCESS_TOKEN_TYPE},
    )
    with pytest.raises(InvalidToken):
        service.verify_access_token(unsigned)


def test_should_reject_a_token_of_another_type_even_with_a_valid_signature() -> None:
    key = _key()
    now = int(datetime.now(UTC).timestamp())
    other = jwt.encode(
        {
            "iss": "lep-backend",
            "aud": "lep-api",
            "sub": str(uuid7()),
            "sid": str(uuid7()),
            "iat": now,
            "nbf": now,
            "exp": now + 60,
            "jti": "x",
        },
        key.get_secret_value(),
        algorithm="HS256",
        headers={"kid": key_id(key), "typ": "JWT"},
    )
    with pytest.raises(InvalidToken):
        _service(key).verify_access_token(other)


def test_should_reject_a_token_missing_the_session_claim() -> None:
    key = _key()
    now = int(datetime.now(UTC).timestamp())
    token = jwt.encode(
        {
            "iss": "lep-backend",
            "aud": "lep-api",
            "sub": str(uuid7()),
            "iat": now,
            "nbf": now,
            "exp": now + 60,
            "jti": "x",
        },
        key.get_secret_value(),
        algorithm="HS256",
        headers={"kid": key_id(key), "typ": ACCESS_TOKEN_TYPE},
    )
    with pytest.raises(InvalidToken):
        _service(key).verify_access_token(token)


@pytest.mark.parametrize("garbage", ["", "abc", "a.b.c", "Bearer x"])
def test_should_reject_malformed_tokens(garbage: str) -> None:
    with pytest.raises(InvalidToken):
        _service(_key()).verify_access_token(garbage)


def test_refresh_tokens_are_random_prefixed_and_stored_only_as_a_hash() -> None:
    token, digest = new_refresh_token()
    other, _ = new_refresh_token()

    assert token.startswith(REFRESH_TOKEN_PREFIX)
    assert token != other
    assert len(digest) == 32
    assert digest == hash_refresh_token(token)
    assert token.encode() not in digest
