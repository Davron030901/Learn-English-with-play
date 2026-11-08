"""The process-wide objects the API needs, built once at startup and closed at shutdown."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import timedelta

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.ai.partner import ClaudePartner, ConversationModel
from app.ai.rater import ClaudeSpeakingRater, ClaudeWritingRater, SpeakingRater, WritingRater
from app.media.ports import SpeechScorer, TtsEngine
from app.clock import Clock
from app.config import Settings
from app.content.catalog import ContentCatalog, load_catalog_cached
from app.db import create_engine, create_sessionmaker
from app.observability.logs import get_logger
from app.observability.metrics import Metrics
from app.redis_client import close_redis, create_redis
from app.mail import Mailer, build_mailer
from app.security.breached import PasswordScreen, build_screen
from app.security.passwords import PasswordHasher
from app.security.rate_limit import Limit, RateLimiter
from app.security.tokens import TokenService
from app.services.auth import AuthPolicy
from app.services.progress import warm_indexes


@dataclass(frozen=True, slots=True)
class RateLimits:
    ip: Limit
    account: Limit
    login_ip: Limit
    login_account: Limit
    register_ip: Limit
    refresh_ip: Limit
    password_reset_ip: Limit
    password_reset_account: Limit
    client_events_ip: Limit

    @classmethod
    def from_settings(cls, settings: Settings) -> RateLimits:
        return cls(
            ip=Limit("ip", settings.rate_limit_ip_per_minute, 60),
            account=Limit("account", settings.rate_limit_account_per_minute, 60),
            login_ip=Limit("login_ip", settings.rate_limit_login_ip_per_minute, 60),
            login_account=Limit("login_account", settings.rate_limit_login_account_per_15min, 900),
            register_ip=Limit("register_ip", settings.rate_limit_register_ip_per_hour, 3_600),
            refresh_ip=Limit("refresh_ip", settings.rate_limit_refresh_per_minute, 60),
            password_reset_ip=Limit(
                "password_reset_ip", settings.rate_limit_password_reset_ip_per_hour, 3_600
            ),
            password_reset_account=Limit(
                "password_reset_account",
                settings.rate_limit_password_reset_account_per_hour,
                3_600,
            ),
            client_events_ip=Limit(
                "client_events_ip", settings.rate_limit_client_events_ip_per_minute, 60
            ),
        )


@dataclass(slots=True)
class AppContainer:
    settings: Settings
    metrics: Metrics
    clock: Clock
    engine: AsyncEngine
    sessionmaker: async_sessionmaker[AsyncSession]
    redis: Redis
    rate_limiter: RateLimiter
    limits: RateLimits
    hasher: PasswordHasher
    tokens: TokenService
    auth_policy: AuthPolicy
    content: ContentCatalog
    #: the AI conversation partner's model; None when no key is configured (feature off)
    ai: ConversationModel | None = None
    #: the writing rater for level exams; None without a key (production stays unscored)
    rater: WritingRater | None = None
    speaking_rater: SpeakingRater | None = None
    #: speech and voice providers; None while LEP_TTS_PROVIDER / LEP_SPEECH_PROVIDER are "none"
    tts: TtsEngine | None = None
    speech: SpeechScorer | None = None
    #: new passwords are screened against common and breached ones (R14)
    password_screen: PasswordScreen | None = None
    #: sends password-reset links; None while LEP_MAIL_BACKEND is "none" (feature off)
    mailer: Mailer | None = None


async def build_container(settings: Settings, metrics: Metrics, clock: Clock) -> AppContainer:
    """Create clients. Nothing here connects yet: a missing database makes the service
    not-ready (``/ready`` 503), not unable to start. Malformed course content, on the other
    hand, stops start-up: the service never serves bad content (brief Phase 2)."""
    content = await asyncio.to_thread(load_catalog_cached, settings.content_dir)
    await asyncio.to_thread(warm_indexes, content)
    await asyncio.to_thread(content.warm_digests)
    get_logger("app.content").info(
        "content_loaded",
        version=content.version,
        **content.totals,
        memory_item_refs=content.memory_item_refs,
        defects=dict(content.defects),
    )
    engine = create_engine(
        settings,
        user=settings.db_user,
        password=settings.db_password,
        application_name=f"{settings.service_name}-api",
    )
    redis = create_redis(settings, client_name=f"{settings.service_name}-api")
    hasher = PasswordHasher(
        time_cost=settings.argon2_time_cost,
        memory_kib=settings.argon2_memory_kib,
        parallelism=settings.argon2_parallelism,
        max_concurrency=settings.password_hash_concurrency,
    )
    await hasher.warm_up()
    metrics.bind_engine(engine)
    return AppContainer(
        settings=settings,
        metrics=metrics,
        clock=clock,
        engine=engine,
        sessionmaker=create_sessionmaker(engine),
        redis=redis,
        rate_limiter=RateLimiter(redis, metrics),
        limits=RateLimits.from_settings(settings),
        hasher=hasher,
        tokens=TokenService(
            secret=settings.jwt_secret,
            previous_secret=settings.jwt_previous_secret,
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            access_ttl=timedelta(seconds=settings.access_token_ttl_s),
            clock=clock,
        ),
        auth_policy=AuthPolicy(
            refresh_ttl=timedelta(seconds=settings.refresh_token_ttl_s),
            session_max_age=timedelta(seconds=settings.session_max_age_s),
            supported_l1=tuple(settings.supported_l1),
        ),
        content=content,
        ai=_build_ai(settings),
        rater=_build_rater(settings),
        speaking_rater=_build_speaking_rater(settings),
        password_screen=build_screen(
            metrics, hibp=settings.hibp_enabled, timeout_s=settings.hibp_timeout_s
        ),
        mailer=build_mailer(settings),
    )


def _build_ai(settings: Settings) -> ConversationModel | None:
    if settings.ai_api_key is None:
        return None
    return ClaudePartner(
        api_key=settings.ai_api_key.get_secret_value(),
        model=settings.ai_model,
        effort=settings.ai_effort,
        timeout_s=settings.ai_timeout_s,
        fallbacks=settings.ai_fallbacks,
    )


def _build_rater(settings: Settings) -> WritingRater | None:
    if settings.ai_api_key is None:
        return None
    return ClaudeWritingRater(
        api_key=settings.ai_api_key.get_secret_value(),
        model=settings.ai_model,
        timeout_s=settings.ai_timeout_s,
    )


def _build_speaking_rater(settings: Settings) -> SpeakingRater | None:
    if settings.ai_api_key is None:
        return None
    return ClaudeSpeakingRater(
        api_key=settings.ai_api_key.get_secret_value(),
        model=settings.ai_model,
        timeout_s=settings.ai_timeout_s,
    )


async def close_container(container: AppContainer) -> None:
    """Called after the server has finished in-flight requests: release the pools."""
    container.metrics.unbind_engine()
    for client in (container.rater, container.speaking_rater):
        rater_closer = getattr(client, "aclose", None)
        if rater_closer is not None:
            await rater_closer()
    closer = getattr(container.ai, "aclose", None)
    if closer is not None:
        await closer()
    try:
        await close_redis(container.redis)
    finally:
        await container.engine.dispose()
