"""Access tokens (short-lived JWTs) and refresh tokens (opaque, rotating).

Access tokens are HS256 JWTs with ``typ: at+jwt`` (RFC 9068) and the smallest useful
claim set: issuer, audience, subject (learner id), session id, times and a unique id —
no email or other personal data. Verification pins the algorithm, the type and the key
id, so a token signed with ``none``, with another algorithm or for another purpose is
rejected before its signature is even checked.

Key rotation: tokens name their key by ``kid`` (a fingerprint, not the key). Set the
new key as ``LEP_JWT_SECRET`` and the old one as ``LEP_JWT_PREVIOUS_SECRET``; tokens
signed with either verify until the old ones expire, then drop the previous key.

Refresh tokens are 256 random bits with a ``lep_rt_`` prefix, so secret scanners can
recognise one pasted where it should not be. Only their SHA-256 is stored.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import jwt
from pydantic import SecretStr

from app.clock import Clock
from app.errors import InvalidToken
from app.ids import uuid7

ALGORITHM = "HS256"
ACCESS_TOKEN_TYPE = "at+jwt"  # noqa: S105 - a JWT "typ" value, not a secret
REFRESH_TOKEN_PREFIX = "lep_rt_"  # noqa: S105 - a public prefix, not a secret
#: Tolerated clock difference between API instances when checking exp/nbf/iat.
CLOCK_SKEW = timedelta(seconds=10)
_REQUIRED_CLAIMS = ["iss", "aud", "sub", "exp", "iat", "nbf", "jti"]


def key_id(secret: SecretStr) -> str:
    return hashlib.sha256(secret.get_secret_value().encode()).hexdigest()[:16]


@dataclass(frozen=True, slots=True)
class AccessClaims:
    learner_id: UUID
    session_id: UUID
    token_id: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class IssuedAccessToken:
    token: str
    expires_at: datetime


class TokenService:
    def __init__(
        self,
        *,
        secret: SecretStr,
        previous_secret: SecretStr | None,
        issuer: str,
        audience: str,
        access_ttl: timedelta,
        clock: Clock,
    ) -> None:
        self._current_kid = key_id(secret)
        self._keys: dict[str, bytes] = {self._current_kid: secret.get_secret_value().encode()}
        if previous_secret is not None:
            self._keys[key_id(previous_secret)] = previous_secret.get_secret_value().encode()
        self._issuer = issuer
        self._audience = audience
        self._access_ttl = access_ttl
        self._clock = clock

    @property
    def access_ttl(self) -> timedelta:
        return self._access_ttl

    def issue_access_token(self, *, learner_id: UUID, session_id: UUID) -> IssuedAccessToken:
        now = self._clock.now()
        expires_at = now + self._access_ttl
        issued = int(now.timestamp())
        payload: dict[str, Any] = {
            "iss": self._issuer,
            "aud": self._audience,
            "sub": str(learner_id),
            "sid": str(session_id),
            "iat": issued,
            "nbf": issued,
            "exp": int(expires_at.timestamp()),
            "jti": uuid7().hex,
        }
        token = jwt.encode(
            payload,
            self._keys[self._current_kid],
            algorithm=ALGORITHM,
            headers={"kid": self._current_kid, "typ": ACCESS_TOKEN_TYPE},
        )
        return IssuedAccessToken(token=token, expires_at=expires_at)

    def verify_access_token(self, token: str) -> AccessClaims:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise InvalidToken("The access token is malformed.") from None
        key = self._keys.get(str(header.get("kid")))
        if header.get("alg") != ALGORITHM or header.get("typ") != ACCESS_TOKEN_TYPE or key is None:
            raise InvalidToken("The access token was not issued by this service.")
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=[ALGORITHM],
                audience=self._audience,
                issuer=self._issuer,
                leeway=CLOCK_SKEW,
                options={"require": _REQUIRED_CLAIMS},
            )
        except jwt.ExpiredSignatureError:
            raise InvalidToken("The access token has expired.") from None
        except jwt.PyJWTError:
            raise InvalidToken("The access token is invalid.") from None
        try:
            return AccessClaims(
                learner_id=UUID(str(claims["sub"])),
                session_id=UUID(str(claims["sid"])),
                token_id=str(claims["jti"]),
                expires_at=datetime.fromtimestamp(int(claims["exp"]), tz=UTC),
            )
        except (KeyError, ValueError, TypeError):
            raise InvalidToken("The access token is invalid.") from None


def new_refresh_token() -> tuple[str, bytes]:
    """A fresh refresh token and the hash to store for it."""
    token = REFRESH_TOKEN_PREFIX + secrets.token_urlsafe(32)
    return token, hash_refresh_token(token)


def hash_refresh_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()
