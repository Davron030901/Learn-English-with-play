"""Forgotten and changed passwords (frontend DECISIONS B5; NIST SP 800-63B §5.1.1.2).

**Forgotten.** ``POST /v1/auth/password/forgot`` answers 202 at once, for any address: the same
response, and the same work inside the request, whether an account uses the address or not —
the lookup, the token and the email all happen after the response (``send_reset_link``), so
neither the answer nor its timing says which addresses are registered. An active account gets
a link that works once, within 30 minutes; a newer request voids the older links. Only the
token's SHA-256 is stored.

**Reset.** The token is looked up under a row lock; the new password is screened (common,
breached, built from the email) and hashed *between* two short transactions, so a pooled
connection is never held while Argon2 runs; the second transaction checks the link again, sets
the password, uses the link, voids every other and revokes **every** session — whoever held the
old password is signed out everywhere.

**Changed** while signed in (``POST /v1/me/password``): the current password is verified first
(the same per-account rate limit as sign-in); the sessions on other devices are revoked, this
one stays signed in.
"""

# ruff: noqa: RUF001 — the Uzbek and Russian copy uses its own letters on purpose

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final
from uuid import UUID

from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.clock import Clock
from app.errors import FieldError, InvalidToken, PasswordRefused, ValidationFailed
from app.ids import uuid7
from app.mail.ports import Mailer, MailUnavailable, Message
from app.observability.logs import get_logger
from app.observability.metrics import Metrics
from app.repositories.auth_sessions import AuthSessionRepository
from app.repositories.learners import LearnerRepository
from app.repositories.password_resets import PasswordResetRepository
from app.security.breached import REFUSALS, PasswordScreen
from app.security.passwords import PasswordHasher

_log = get_logger("app.passwords")


class ResetLinkInvalid(Exception):
    """The link is unknown, used, expired, or its account is no longer active."""


def hash_reset_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def new_reset_token() -> tuple[str, bytes]:
    """A fresh 256-bit token for a link, and the hash to store for it."""
    token = secrets.token_urlsafe(32)
    return token, hash_reset_token(token)


def reset_link(base_url: str, token: str) -> str:
    return f"{base_url}?token={token}"


_SUBJECTS: Final = {
    "en": "Reset your Learn English with Play password",
    "uz": "Learn English with Play parolini tiklash",
    "ru": "Сброс пароля Learn English with Play",
}
_BODIES: Final = {
    "en": (
        "Someone asked to reset the password of this Learn English with Play account.\n\n"
        "To choose a new password, open this link within {minutes} minutes:\n{link}\n\n"
        "The link works once. If you did not ask for this, ignore this email: your password "
        "stays as it is."
    ),
    "uz": (
        "Learn English with Play hisobingiz parolini tiklash soʻraldi.\n\n"
        "Yangi parol tanlash uchun {minutes} daqiqa ichida ushbu havolani oching:\n{link}\n\n"
        "Havola faqat bir marta ishlaydi. Agar buni siz soʻramagan boʻlsangiz, bu xatga "
        "eʼtibor bermang: parolingiz oʻzgarmaydi."
    ),
    "ru": (
        "Кто-то запросил сброс пароля этого аккаунта Learn English with Play.\n\n"
        "Чтобы выбрать новый пароль, откройте эту ссылку в течение {minutes} минут:\n{link}\n\n"
        "Ссылка работает один раз. Если вы этого не запрашивали, просто проигнорируйте письмо: "
        "пароль останется прежним."
    ),
}


def reset_message(to: str, l1: str, link: str, minutes: int) -> Message:
    """In the learner's first language when the app speaks it, then in English."""
    lang = l1.split("-")[0]
    parts = [lang, "en"] if lang in _BODIES and lang != "en" else ["en"]
    text = "\n\n—\n\n".join(_BODIES[p].format(minutes=minutes, link=link) for p in parts)
    return Message(to=to, subject=_SUBJECTS[parts[0]], text=text + "\n")


@dataclass(frozen=True, slots=True)
class ResetPolicy:
    url: str
    ttl: timedelta


async def send_reset_link(
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
    clock: Clock,
    metrics: Metrics,
    policy: ResetPolicy,
    email: str,
) -> None:
    """After the 202: look the address up and, for an active account, store a link and send it.
    Runs as a background task, so it never raises."""
    try:
        now = clock.now()
        async with sessionmaker() as session, session.begin():
            learners = LearnerRepository(session)
            credentials = await learners.credentials(email)
            if credentials is None or credentials.status != "active":
                metrics.mail_events.labels(kind="password_reset", outcome="no_account").inc()
                return
            profile = await learners.profile(credentials.learner_id)
            if profile is None:
                return
            resets = PasswordResetRepository(session)
            await resets.void_all(credentials.learner_id, at=now)
            token, token_hash = new_reset_token()
            await resets.add(
                token_id=uuid7(),
                learner_id=credentials.learner_id,
                token_hash=token_hash,
                now=now,
                expires_at=now + policy.ttl,
            )
        minutes = int(policy.ttl.total_seconds() // 60)
        await mailer.send(
            reset_message(profile.email, profile.l1, reset_link(policy.url, token), minutes)
        )
        metrics.mail_events.labels(kind="password_reset", outcome="sent").inc()
        _log.info("password_reset_link_sent", learner_id=str(credentials.learner_id))
    except MailUnavailable as exc:
        metrics.mail_events.labels(kind="password_reset", outcome="failed").inc()
        _log.warning("password_reset_mail_failed", error=str(exc))
    except Exception:  # noqa: BLE001 — a background task must never raise into the server
        metrics.mail_events.labels(kind="password_reset", outcome="failed").inc()
        _log.exception("password_reset_failed")


class PasswordService:
    def __init__(
        self,
        *,
        session: AsyncSession,
        hasher: PasswordHasher,
        screen: PasswordScreen,
        clock: Clock,
        metrics: Metrics,
    ) -> None:
        self._session = session
        self._hasher = hasher
        self._screen = screen
        self._clock = clock
        self._metrics = metrics

    async def _screened_hash(self, password: SecretStr, email: str, field: str) -> str:
        reason = await self._screen.check(password, email=email)
        if reason is not None:
            raise PasswordRefused(field, reason, REFUSALS[reason])
        return await self._hasher.hash(password)

    async def reset(self, token: SecretStr, new_password: SecretStr) -> UUID:
        """Set a new password from a link; every session of the account ends."""
        token_hash = hash_reset_token(token.get_secret_value())
        async with self._session.begin():
            learner_id = await self._valid(token_hash)
            profile = await LearnerRepository(self._session).profile(learner_id)
            if profile is None:
                raise ResetLinkInvalid
        password_hash = await self._screened_hash(new_password, profile.email, "new_password")
        now = self._clock.now()
        async with self._session.begin():
            if await self._valid(token_hash) != learner_id:
                raise ResetLinkInvalid
            await LearnerRepository(self._session).set_password_hash(learner_id, password_hash)
            await PasswordResetRepository(self._session).void_all(learner_id, at=now)
            ended = await AuthSessionRepository(self._session).revoke_all(
                learner_id, reason="password_change", at=now
            )
        self._metrics.auth_events.labels(event="password_reset").inc()
        _log.info("password_reset", learner_id=str(learner_id), sessions_ended=ended)
        return learner_id

    async def _valid(self, token_hash: bytes) -> UUID:
        candidate = await PasswordResetRepository(self._session).lock(token_hash)
        now = self._clock.now()
        if candidate is None or candidate.used_at is not None or candidate.expires_at <= now:
            raise ResetLinkInvalid
        credentials = await LearnerRepository(self._session).status(candidate.learner_id)
        if credentials != "active":
            raise ResetLinkInvalid
        return candidate.learner_id

    async def change(
        self,
        learner_id: UUID,
        session_id: UUID,
        current: SecretStr,
        new_password: SecretStr,
        *,
        now: datetime | None = None,
    ) -> int:
        """Change a password while signed in; the other devices' sessions end. Returns how many."""
        async with self._session.begin():
            learners = LearnerRepository(self._session)
            profile = await learners.profile(learner_id)
            credentials = await learners.credentials(profile.email) if profile else None
        if profile is None or credentials is None or credentials.learner_id != learner_id:
            raise InvalidToken("This account no longer exists.")
        if not await self._hasher.verify(credentials.password_hash, current):
            self._metrics.auth_events.labels(event="password_change_failure").inc()
            raise ValidationFailed(
                [FieldError("current_password", "this is not your current password")]
            )
        if new_password.get_secret_value() == current.get_secret_value():
            raise PasswordRefused(
                "new_password", "unchanged", "choose a password different from the current one"
            )
        password_hash = await self._screened_hash(new_password, profile.email, "new_password")
        at = now or self._clock.now()
        async with self._session.begin():
            await LearnerRepository(self._session).set_password_hash(learner_id, password_hash)
            await PasswordResetRepository(self._session).void_all(learner_id, at=at)
            ended = await AuthSessionRepository(self._session).revoke_all(
                learner_id, reason="password_change", at=at, keep=session_id
            )
        self._metrics.auth_events.labels(event="password_change").inc()
        _log.info("password_changed", learner_id=str(learner_id), sessions_ended=ended)
        return ended

    async def screen_new(self, password: SecretStr, email: str, field: str = "password") -> None:
        """Registration's check: raise 422 when the password should not be chosen."""
        reason = await self._screen.check(password, email=email)
        if reason is not None:
            raise PasswordRefused(field, reason, REFUSALS[reason])
