"""Authentication requests and responses."""

from __future__ import annotations

import unicodedata
from functools import cache
from typing import Any, Literal, Self
from zoneinfo import available_timezones

from email_validator import EmailNotValidError, validate_email

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)

from app.config import LANGUAGE_TAG_PATTERN
from app.schemas.learner import LearnerOut

PASSWORD_MIN_LENGTH = 10
PASSWORD_MAX_LENGTH = 256
EMAIL_MAX_LENGTH = 254  # RFC 5321 forward-path limit


@cache
def _time_zones() -> frozenset[str]:
    return frozenset(available_timezones())


def normalise_login_email(raw: str) -> str:
    """The form registration stored: pydantic's ``EmailStr`` keeps email-validator's
    ``normalized`` address, so sign-in must look up the same normalisation (an IDNA or NFD
    spelling of the same address otherwise misses the account)."""
    text = raw.strip()
    try:
        return validate_email(text, check_deliverability=False).normalized
    except EmailNotValidError:
        return text


def rate_limit_key_for_email(email: str) -> str:
    """A per-account rate-limit key that is never *finer* than the database's match.

    The account lookup compares ``citext`` (PostgreSQL ``lower()``), which can map characters
    Python's ``casefold()`` keeps apart (``İ`` → ``i`` under libc, but ``i̇`` in Python).
    Lower-casing, decomposing and dropping combining marks merges every such spelling into one
    bucket; merging more than the database does is the safe direction, splitting is not.
    """
    folded = unicodedata.normalize("NFKD", email.casefold())
    return "".join(c for c in folded if not unicodedata.combining(c))


class RegisterRequest(BaseModel):
    # No str_strip_whitespace: it would also strip the password, which sign-in then compares
    # unstripped — the account could never sign in. Only the plain text fields are trimmed.
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: SecretStr = Field(
        min_length=PASSWORD_MIN_LENGTH,
        max_length=PASSWORD_MAX_LENGTH,
        description="10 to 256 characters. No composition rules (NIST SP 800-63B).",
    )
    l1: str = Field(
        min_length=2,
        max_length=16,
        pattern=LANGUAGE_TAG_PATTERN,
        description="First language as a language tag, e.g. uz or ru.",
        examples=["uz"],
    )
    birth_year: int = Field(
        ge=1900, le=2100, description="Year only; used for the 13+ gate and minor protections."
    )
    tz: str = Field(
        min_length=1,
        max_length=64,
        description="IANA time zone; decides where the learner's day starts.",
        examples=["Asia/Tashkent"],
    )
    daily_goal_min: Literal[5, 10, 20, 40] = 10
    spelling_variant: Literal["us", "uk"] = Field(
        default="us", description="docs/00 §2.1: the learner picks US or UK spelling."
    )

    @field_validator("email", "l1", "tz", mode="before")
    @classmethod
    def _trim(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("email")
    @classmethod
    def _email_length(cls, email: str) -> str:
        if len(email) > EMAIL_MAX_LENGTH:
            raise ValueError(f"must be at most {EMAIL_MAX_LENGTH} characters")
        return email

    @field_validator("tz")
    @classmethod
    def _iana_zone(cls, tz: str) -> str:
        if tz not in _time_zones():
            raise ValueError("must be an IANA time zone name such as Asia/Tashkent")
        return tz

    @model_validator(mode="after")
    def _password_not_email(self) -> Self:
        if self.password.get_secret_value().strip().casefold() == self.email.casefold():
            raise ValueError("the password must not be the email address")
        return self


class LoginForm(BaseModel):
    """OAuth 2.0 resource-owner password grant (RFC 6749 §4.3), form-encoded."""

    model_config = ConfigDict(extra="ignore")

    grant_type: Literal["password"] | None = None
    username: str = Field(min_length=3, max_length=EMAIL_MAX_LENGTH, description="The email.")
    password: SecretStr = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: SecretStr | None = Field(
        default=None,
        min_length=16,
        max_length=512,
        description="Required, except for a web client using the refresh cookie.",
    )


class LogoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: SecretStr | None = Field(
        default=None,
        min_length=16,
        max_length=512,
        description="Required, except for a web client using the refresh cookie.",
    )


class TokenResponse(BaseModel):
    """RFC 6749 §5.1 token response."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - the OAuth 2.0 token type name
    expires_in: int = Field(description="Seconds until the access token expires.")
    refresh_token: str | None = Field(
        description="Null when it was set as an httpOnly cookie instead "
        "(`X-LEP-Token-Transport: cookie`, web clients only)."
    )
    refresh_expires_in: int = Field(description="Seconds until the refresh token expires.")


class RegisterResponse(BaseModel):
    learner: LearnerOut
    tokens: TokenResponse


class PasswordForgotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=EMAIL_MAX_LENGTH)

    @field_validator("email", mode="before")
    @classmethod
    def _trim(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value


class PasswordForgotOut(BaseModel):
    accepted: Literal[True] = True
    expires_in_minutes: int = Field(description="How long an emailed link works.")
    detail: str = Field(
        default="If an account uses this address, a link to set a new password is on its way.",
        description="The same for every address: the answer never says whether it has an account.",
    )


class PasswordResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: SecretStr = Field(min_length=20, max_length=128, description="From the emailed link.")
    new_password: SecretStr = Field(
        min_length=PASSWORD_MIN_LENGTH,
        max_length=PASSWORD_MAX_LENGTH,
        description="10 to 256 characters; common and breached passwords are refused.",
    )


class PasswordChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: SecretStr = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)
    new_password: SecretStr = Field(
        min_length=PASSWORD_MIN_LENGTH,
        max_length=PASSWORD_MAX_LENGTH,
        description="10 to 256 characters; common and breached passwords are refused.",
    )
