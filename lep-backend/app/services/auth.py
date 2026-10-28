"""Registration, sign-in, token refresh and sign-out.

Transactions are kept short and never span a password hash: Argon2 runs before the
write transaction opens (registration) or between two short transactions (sign-in), so
a pooled connection is never held while a CPU-bound hash runs.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.clock import Clock
from app.domain.age_policy import (
    MINIMUM_AGE,
    InvalidBirthYear,
    meets_minimum_age,
)
from app.errors import (
    AgeRequirementNotMet,
    EmailAlreadyRegistered,
    FieldError,
    InvalidCredentials,
    InvalidToken,
    PasswordRefused,
    SessionRevoked,
    ValidationFailed,
)
from app.ids import uuid7
from app.observability.logs import get_logger
from app.observability.metrics import Metrics
from app.repositories.auth_sessions import AuthSessionRepository, PurgeResult, RefreshCandidate
from app.repositories.learners import LearnerRepository, NewLearner
from app.repositories.password_resets import PasswordResetRepository
from app.security.breached import PasswordScreen
from app.security.breached import REFUSALS as PASSWORD_REFUSALS
from app.security.passwords import PasswordHasher
from app.security.tokens import TokenService, hash_refresh_token, new_refresh_token

USER_AGENT_MAX = 256

_log = get_logger("app.auth")


@dataclass(frozen=True, slots=True)
class Registration:
    email: str
    password: SecretStr
    l1: str
    birth_year: int
    tz: str
    daily_goal_min: int
    spelling_variant: str


@dataclass(frozen=True, slots=True)
class IssuedTokens:
    learner_id: UUID
    session_id: UUID
    access_token: str
    access_expires_at: datetime
    refresh_token: str
    refresh_expires_at: datetime


@dataclass(frozen=True, slots=True)
class Principal:
    """The authenticated caller of a request."""

    learner_id: UUID
    session_id: UUID


@dataclass(frozen=True, slots=True)
class _Rotated:
    refresh_token: str
    refresh_expires_at: datetime


@dataclass(frozen=True, slots=True)
class _Reused:
    session_id: UUID


@dataclass(frozen=True, slots=True)
class AuthPolicy:
    refresh_ttl: timedelta
    session_max_age: timedelta
    supported_l1: Sequence[str]


class AuthService:
    def __init__(
        self,
        *,
        session: AsyncSession,
        hasher: PasswordHasher,
        tokens: TokenService,
        clock: Clock,
        policy: AuthPolicy,
        metrics: Metrics,
        screen: PasswordScreen | None = None,
    ) -> None:
        self._session = session
        self._hasher = hasher
        self._tokens = tokens
        self._clock = clock
        self._policy = policy
        self._metrics = metrics
        self._screen = screen

    async def register(self, registration: Registration, *, user_agent: str | None) -> IssuedTokens:
        self._check_registration_policy(registration)
        if self._screen is not None:
            reason = await self._screen.check(registration.password, email=registration.email)
            if reason is not None:
                raise PasswordRefused("password", reason, PASSWORD_REFUSALS[reason])
        password_hash = await self._hasher.hash(registration.password)
        learner_id = uuid7()
        async with self._session.begin():
            created = await LearnerRepository(self._session).insert(
                NewLearner(
                    id=learner_id,
                    email=registration.email,
                    password_hash=password_hash,
                    l1=registration.l1,
                    birth_year=registration.birth_year,
                    tz=registration.tz,
                    daily_goal_min=registration.daily_goal_min,
                    spelling_variant=registration.spelling_variant,
                )
            )
            if not created:
                raise EmailAlreadyRegistered("An account with this email already exists.")
            issued = await self._start_session(learner_id, user_agent)
        self._metrics.auth_events.labels(event="register").inc()
        _log.info("learner_registered", learner_id=str(learner_id), l1=registration.l1)
        return issued

    async def login(
        self, email: str, password: SecretStr, *, user_agent: str | None
    ) -> IssuedTokens:
        async with self._session.begin():
            credentials = await LearnerRepository(self._session).credentials(email)
        verified = await self._hasher.verify(
            credentials.password_hash if credentials else None, password
        )
        if credentials is None or not verified or credentials.status != "active":
            self._metrics.auth_events.labels(event="login_failure").inc()
            raise InvalidCredentials()
        rehash = (
            await self._hasher.hash(password)
            if self._hasher.needs_rehash(credentials.password_hash)
            else None
        )
        async with self._session.begin():
            learners = LearnerRepository(self._session)
            # the password may have been reset or changed while Argon2 ran: a session is only
            # started for the hash that was verified, and a rehash never writes an old one back
            if await learners.lock_password_hash(credentials.learner_id) != (
                credentials.password_hash
            ):
                self._metrics.auth_events.labels(event="login_failure").inc()
                raise InvalidCredentials()
            if rehash is not None:
                await learners.set_password_hash(credentials.learner_id, rehash)
            issued = await self._start_session(credentials.learner_id, user_agent)
        self._metrics.auth_events.labels(event="login_success").inc()
        _log.info(
            "login_succeeded",
            learner_id=str(credentials.learner_id),
            session_id=str(issued.session_id),
            rehashed=rehash is not None,
        )
        return issued

    async def refresh(self, presented: SecretStr) -> IssuedTokens:
        now = self._clock.now()
        token_hash = hash_refresh_token(presented.get_secret_value())
        outcome: _Rotated | _Reused
        async with self._session.begin():
            repo = AuthSessionRepository(self._session)
            candidate = await repo.lock_for_refresh(token_hash)
            if candidate is None:
                raise InvalidToken("The refresh token is not recognised.")
            if candidate.session_revoked_at is not None:
                raise SessionRevoked("This session has ended; please sign in again.")
            if candidate.token_used_at is not None:
                # Already rotated, so someone holds a copy. End the session for every
                # holder; the transaction commits so that the revocation sticks.
                await repo.revoke(candidate.session_id, reason="refresh_token_reuse", at=now)
                outcome = _Reused(candidate.session_id)
            elif (
                candidate.token_expires_at <= now
                or candidate.session_expires_at <= now
                or candidate.learner_status != "active"
            ):
                raise InvalidToken("The refresh token has expired; please sign in again.")
            else:
                outcome = await self._rotate(repo, candidate, now)
        if isinstance(outcome, _Reused):
            self._metrics.auth_events.labels(event="refresh_reuse_detected").inc()
            _log.warning("refresh_token_reuse_detected", session_id=str(outcome.session_id))
            raise SessionRevoked(
                "This refresh token was already used, so the session has been ended for "
                "safety; please sign in again."
            )
        access = self._tokens.issue_access_token(
            learner_id=candidate.learner_id, session_id=candidate.session_id
        )
        self._metrics.auth_events.labels(event="refresh").inc()
        return IssuedTokens(
            learner_id=candidate.learner_id,
            session_id=candidate.session_id,
            access_token=access.token,
            access_expires_at=access.expires_at,
            refresh_token=outcome.refresh_token,
            refresh_expires_at=outcome.refresh_expires_at,
        )

    async def _rotate(
        self, repo: AuthSessionRepository, candidate: RefreshCandidate, now: datetime
    ) -> _Rotated:
        refresh_token, token_hash = new_refresh_token()
        token_id = uuid7()
        expires_at = min(now + self._policy.refresh_ttl, candidate.session_expires_at)
        await repo.add_refresh_token(
            token_id=token_id,
            session_id=candidate.session_id,
            token_hash=token_hash,
            now=now,
            expires_at=expires_at,
        )
        await repo.mark_rotated(candidate.token_id, used_at=now, replaced_by=token_id)
        await repo.touch(candidate.session_id, at=now)
        return _Rotated(refresh_token=refresh_token, refresh_expires_at=expires_at)

    async def logout(self, presented: SecretStr) -> None:
        """Revoke the session that owns this refresh token. Unknown tokens are ignored,
        so the endpoint is idempotent and reveals nothing."""
        now = self._clock.now()
        async with self._session.begin():
            repo = AuthSessionRepository(self._session)
            session_id = await repo.session_for_refresh_token(
                hash_refresh_token(presented.get_secret_value())
            )
            revoked = session_id is not None and await repo.revoke(
                session_id, reason="logout", at=now
            )
        if revoked:
            self._metrics.auth_events.labels(event="logout").inc()
            _log.info("logout", session_id=str(session_id))

    async def authenticate(self, access_token: str) -> Principal:
        """Verify an access token and that its session is still live.

        The session check makes sign-out and reuse detection take effect immediately
        rather than when the access token expires.
        """
        claims = self._tokens.verify_access_token(access_token)
        async with self._session.begin():
            active = await AuthSessionRepository(self._session).is_active(
                session_id=claims.session_id, learner_id=claims.learner_id, now=self._clock.now()
            )
        if not active:
            raise InvalidToken("This session has ended; please sign in again.")
        return Principal(learner_id=claims.learner_id, session_id=claims.session_id)

    def _check_registration_policy(self, registration: Registration) -> None:
        today = self._clock.now().date()
        try:
            old_enough = meets_minimum_age(registration.birth_year, today)
        except InvalidBirthYear as exc:
            raise ValidationFailed([FieldError("birth_year", str(exc))]) from None
        if not old_enough:
            raise AgeRequirementNotMet(
                f"This course is for learners aged {MINIMUM_AGE} and over. A track for "
                "younger learners is not available yet."
            )
        if registration.l1 not in self._policy.supported_l1:
            supported = ", ".join(self._policy.supported_l1)
            raise ValidationFailed(
                [
                    FieldError(
                        "l1", f"this first language is not supported yet; supported: {supported}"
                    )
                ]
            )

    async def _start_session(self, learner_id: UUID, user_agent: str | None) -> IssuedTokens:
        """Create a session with its first refresh token. Runs inside the caller's transaction."""
        now = self._clock.now()
        session_id = uuid7()
        session_expires_at = now + self._policy.session_max_age
        refresh_expires_at = min(now + self._policy.refresh_ttl, session_expires_at)
        refresh_token, token_hash = new_refresh_token()
        repo = AuthSessionRepository(self._session)
        await repo.create_session(
            session_id=session_id,
            learner_id=learner_id,
            now=now,
            expires_at=session_expires_at,
            user_agent=user_agent[:USER_AGENT_MAX] if user_agent else None,
        )
        await repo.add_refresh_token(
            token_id=uuid7(),
            session_id=session_id,
            token_hash=token_hash,
            now=now,
            expires_at=refresh_expires_at,
        )
        access = self._tokens.issue_access_token(learner_id=learner_id, session_id=session_id)
        return IssuedTokens(
            learner_id=learner_id,
            session_id=session_id,
            access_token=access.token,
            access_expires_at=access.expires_at,
            refresh_token=refresh_token,
            refresh_expires_at=refresh_expires_at,
        )


async def purge_auth_records(
    sessionmaker: async_sessionmaker[AsyncSession],
    *,
    cutoff: datetime,
    batch_size: int = 5_000,
) -> PurgeResult:
    """Delete ended sessions, expired refresh tokens and expired reset links older than ``cutoff``.

    Each batch is its own short transaction, so a large backlog never holds long locks.
    """
    sessions = tokens = 0
    while True:
        async with sessionmaker() as session, session.begin():
            deleted = await AuthSessionRepository(session).purge_sessions_before(
                cutoff, batch_size=batch_size
            )
        sessions += deleted
        if deleted < batch_size:
            break
    while True:
        async with sessionmaker() as session, session.begin():
            deleted = await AuthSessionRepository(session).purge_refresh_tokens_before(
                cutoff, batch_size=batch_size
            )
        tokens += deleted
        if deleted < batch_size:
            break
    resets = 0
    while True:
        async with sessionmaker() as session, session.begin():
            deleted = await PasswordResetRepository(session).purge_before(
                cutoff, batch_size=batch_size
            )
        resets += deleted
        if deleted < batch_size:
            break
    return PurgeResult(sessions=sessions, refresh_tokens=tokens, password_resets=resets)
