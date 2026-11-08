"""Typed, fail-fast configuration.

Every value comes from an environment variable prefixed ``LEP_`` or, for secrets,
from a file of the same name in the secrets directory (``/run/secrets`` by default,
the Docker and Kubernetes convention, so a secret never has to be a plain
environment variable).

Three processes read configuration, and each is given only what it needs:

* ``Settings``          — the API, and the only process that holds the JWT key
* ``WorkerSettings``    — the Celery worker and beat
* ``MigrationSettings`` — Alembic, with the schema-owner credentials

Loading fails before anything starts. The error names each variable that is
missing or invalid and never echoes a value, because a value may be a secret.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Annotated, Any, Literal, Self
from urllib.parse import quote, urlsplit

from pydantic import Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import URL

Environment = Literal["dev", "test", "prod"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR"]
SslMode = Literal["disable", "prefer", "require", "verify-full"]

ENV_PREFIX = "LEP_"
SECRETS_DIR_ENV = "LEP_SECRETS_DIR"
DEFAULT_SECRETS_DIR = Path("/run/secrets")

#: OWASP Password Storage Cheat Sheet minimum for Argon2id: m = 19 MiB, t = 2, p = 1.
ARGON2_MIN_MEMORY_KIB = 19_456
ARGON2_MIN_TIME_COST = 2
#: RFC 7518 §3.2: an HMAC key must be at least as long as the hash output (32 bytes).
JWT_MIN_SECRET_BYTES = 32

#: A BCP 47 subset: language, optional script, optional region (``uz``, ``uz-Latn``, ``pt-BR``).
LANGUAGE_TAG_PATTERN = r"^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$"
_LANGUAGE_TAG = re.compile(LANGUAGE_TAG_PATTERN)

#: The packed course the app also ships. In this repository it sits beside the backend; a
#: container mounts it and sets LEP_CONTENT_DIR.
DEFAULT_CONTENT_DIR = (
    Path(__file__).resolve().parents[2] / "Claude outputs" / "new-in-tashkent" / "data"
)

#: Comma-separated in the environment (``LEP_CORS_ORIGINS=https://a.example,https://b.example``).
CsvList = Annotated[list[str], NoDecode]


class ConfigError(RuntimeError):
    """Configuration is missing or invalid. The message never contains a value."""


def _split_csv(value: Any) -> Any:
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    return value


class _SettingsBase(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix=ENV_PREFIX,
        case_sensitive=False,
        extra="ignore",
        frozen=True,
        hide_input_in_errors=True,
    )


class CommonSettings(_SettingsBase):
    env: Environment = Field(description="Deployment environment: dev, test or prod.")
    service_name: str = Field(default="lep-backend", pattern=r"^[a-z][a-z0-9-]{1,62}$")
    log_level: LogLevel = "INFO"
    log_json: bool = True
    otel_exporter_otlp_endpoint: str | None = None
    otel_sample_ratio: float = Field(default=0.05, ge=0.0, le=1.0)

    @field_validator("otel_exporter_otlp_endpoint")
    @classmethod
    def _http_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ValueError("must be an http(s) URL such as http://otel-collector:4318")
        return value.rstrip("/")


class ContentSettings(_SettingsBase):
    content_dir: Path = Field(
        default=DEFAULT_CONTENT_DIR,
        description="Directory holding the packed course (index.json, u001.json … u168.json).",
    )
    content_cdn_base_url: str | None = Field(
        default=None,
        description="Where `scripts/export_bundle.py` output is published (immutable, keyed by "
        "hash). Unset: the bundle manifests point at the API's own /v1/course and /v1/units.",
    )

    @field_validator("content_cdn_base_url")
    @classmethod
    def _cdn_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parts = urlsplit(value)
        if parts.scheme != "https" or not parts.netloc or parts.query or parts.fragment:
            raise ValueError("must be an https URL such as https://cdn.example.org/content")
        return value.rstrip("/")


class MediaSettings(_SettingsBase):
    """Audio files and the speech and voice providers (backend brief §10). The providers are
    server-side only; with ``none`` the feature reports itself unavailable."""

    media_dir: Path = Field(default=Path("var/media"), description="where audio files are kept")
    tts_provider: Literal["none"] = "none"
    speech_provider: Literal["none"] = "none"
    #: uniform, published daily ceilings per learner (never sold)
    tts_chars_per_day: int = Field(default=4_000, ge=0, le=1_000_000)
    speech_seconds_per_day: int = Field(default=900, ge=0, le=86_400)
    #: docs/11 §10: voice recordings are kept 30 days unless the learner chooses less
    voice_retention_days: int = Field(default=30, ge=1, le=30)
    max_recording_seconds: int = Field(default=90, ge=5, le=300)


class DatabaseSettings(_SettingsBase):
    db_host: str = Field(min_length=1, max_length=253)
    db_port: int = Field(default=5432, ge=1, le=65535)
    db_name: str = Field(min_length=1, max_length=63)
    db_ssl_mode: SslMode = "require"
    db_connect_timeout_s: float = Field(default=5.0, gt=0, le=60)
    db_statement_timeout_ms: int = Field(default=5_000, ge=100, le=600_000)
    db_pool_size: int = Field(default=10, ge=1, le=100)
    db_max_overflow: int = Field(default=5, ge=0, le=100)
    db_pool_timeout_s: float = Field(default=5.0, gt=0, le=60)

    def sqlalchemy_url(self, user: str, password: SecretStr) -> URL:
        """Connection URL; ``str(url)`` masks the password, so it is safe to log."""
        return URL.create(
            drivername="postgresql+asyncpg",
            username=user,
            password=password.get_secret_value(),
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
        )


class RedisSettings(_SettingsBase):
    redis_host: str = Field(min_length=1, max_length=253)
    redis_port: int = Field(default=6379, ge=1, le=65535)
    redis_db: int = Field(default=0, ge=0, le=15)
    redis_password: SecretStr | None = None
    redis_ssl: bool = False
    redis_socket_timeout_s: float = Field(default=1.0, gt=0, le=30)
    redis_connect_timeout_s: float = Field(default=1.0, gt=0, le=30)
    redis_max_connections: int = Field(default=64, ge=1, le=10_000)
    celery_broker_db: int = Field(default=1, ge=0, le=15)

    @model_validator(mode="after")
    def _separate_broker_db(self) -> Self:
        if self.celery_broker_db == self.redis_db:
            raise ValueError(
                "LEP_CELERY_BROKER_DB must differ from LEP_REDIS_DB so queue keys never mix "
                "with cache and rate-limit keys"
            )
        return self

    def celery_broker_url(self) -> str:
        scheme = "rediss" if self.redis_ssl else "redis"
        auth = ""
        if self.redis_password is not None:
            auth = f":{quote(self.redis_password.get_secret_value(), safe='')}@"
        host = f"[{self.redis_host}]" if ":" in self.redis_host else self.redis_host
        url = f"{scheme}://{auth}{host}:{self.redis_port}/{self.celery_broker_db}"
        return f"{url}?ssl_cert_reqs=required" if self.redis_ssl else url


class MailSettings(_SettingsBase):
    """Email, used only to send a password-reset link (frontend DECISIONS B5). With ``none`` the
    feature reports itself unavailable; ``file`` writes each message to a directory (local and
    test stacks only); ``smtp`` speaks to any SMTP relay, so no provider is chosen here."""

    mail_backend: Literal["none", "smtp", "file"] = "none"
    mail_from: str | None = Field(
        default=None,
        max_length=254,
        description="The From header, e.g. 'Learn English <no-reply@example.org>'.",
    )
    mail_outbox_dir: Path = Field(default=Path("var/mail"), description="the file backend's")
    smtp_host: str | None = Field(default=None, min_length=1, max_length=253)
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str | None = Field(default=None, min_length=1, max_length=254)
    smtp_password: SecretStr | None = None
    smtp_tls: Literal["starttls", "ssl", "none"] = "starttls"
    smtp_timeout_s: float = Field(default=10.0, gt=0, le=120)
    #: the page that sets a new password; the token is appended as ``?token=…``
    password_reset_url: str | None = None
    password_reset_ttl_s: int = Field(default=1_800, ge=300, le=3_600)

    @field_validator("password_reset_url")
    @classmethod
    def _reset_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parts = urlsplit(value)
        if parts.scheme not in ("https", "http", "lep") or parts.query or parts.fragment:
            raise ValueError(
                "must be a URL without a query, such as https://app.example.org/reset-password"
            )
        if parts.scheme != "lep" and not parts.netloc:
            raise ValueError("must name a host, such as https://app.example.org/reset-password")
        return value


def _require_mail(settings: MailSettings, env: str) -> None:
    if settings.mail_backend == "none":
        return
    if settings.password_reset_url is None or not settings.mail_from:
        raise ValueError(
            "LEP_PASSWORD_RESET_URL and LEP_MAIL_FROM are required when LEP_MAIL_BACKEND is set"
        )
    if settings.mail_backend == "smtp" and settings.smtp_host is None:
        raise ValueError("LEP_SMTP_HOST is required when LEP_MAIL_BACKEND=smtp")
    if settings.mail_backend == "smtp" and (settings.smtp_username is None) != (
        settings.smtp_password is None
    ):
        raise ValueError("LEP_SMTP_USERNAME and LEP_SMTP_PASSWORD are set together or not at all")
    if env == "prod":
        if settings.mail_backend == "file":
            raise ValueError("LEP_MAIL_BACKEND=file is for local and test stacks, not prod")
        if settings.smtp_tls == "none":
            raise ValueError("LEP_SMTP_TLS must be 'starttls' or 'ssl' when LEP_ENV=prod")
        # a custom scheme can be claimed by any app on the device: in prod the link is an
        # https page (or a verified App Link / Universal Link the app claims)
        if not settings.password_reset_url.startswith("https://"):
            raise ValueError("LEP_PASSWORD_RESET_URL must be https when LEP_ENV=prod")


def _require_database_tls(env: str, ssl_mode: str) -> None:
    """In production, database credentials never cross the network in plain text."""
    if env == "prod" and ssl_mode not in ("require", "verify-full"):
        raise ValueError("LEP_DB_SSL_MODE must be 'require' or 'verify-full' when LEP_ENV=prod")


def _require_redis_auth(env: str, password: SecretStr | None) -> None:
    if env == "prod" and (password is None or not password.get_secret_value()):
        raise ValueError("LEP_REDIS_PASSWORD is required when LEP_ENV=prod")


def _require_metrics_token(env: str, token: SecretStr | None) -> None:
    """In production /metrics is never public: it needs a non-empty bearer token."""
    if env == "prod" and (token is None or not token.get_secret_value()):
        raise ValueError("LEP_METRICS_TOKEN is required when LEP_ENV=prod")


class Settings(
    CommonSettings, DatabaseSettings, RedisSettings, ContentSettings, MediaSettings, MailSettings
):
    """The API process."""

    # database credentials: the runtime role, which can read and write rows but not DDL
    db_user: str = Field(min_length=1, max_length=63)
    db_password: SecretStr

    # HTTP
    cors_origins: CsvList = Field(default_factory=list)
    max_body_bytes: int = Field(default=1_048_576, ge=1_024, le=67_108_864)
    docs_enabled: bool | None = None
    metrics_token: SecretStr | None = None

    # tokens
    jwt_secret: SecretStr
    jwt_previous_secret: SecretStr | None = None
    jwt_issuer: str = Field(default="lep-backend", min_length=1, max_length=128)
    jwt_audience: str = Field(default="lep-api", min_length=1, max_length=128)
    access_token_ttl_s: int = Field(default=900, ge=60, le=3_600)
    refresh_token_ttl_s: int = Field(default=2_592_000, ge=3_600, le=7_776_000)
    session_max_age_s: int = Field(default=7_776_000, ge=3_600, le=31_536_000)

    # password hashing (Argon2id)
    argon2_time_cost: int = Field(default=2, ge=1, le=10)
    argon2_memory_kib: int = Field(default=19_456, ge=8, le=1_048_576)
    argon2_parallelism: int = Field(default=1, ge=1, le=16)
    password_hash_concurrency: int = Field(default=4, ge=1, le=64)

    # rate limits: token buckets, burst = the number, refilled over the named window
    rate_limit_ip_per_minute: int = Field(default=300, ge=1, le=1_000_000)
    rate_limit_account_per_minute: int = Field(default=600, ge=1, le=1_000_000)
    rate_limit_login_ip_per_minute: int = Field(default=20, ge=1, le=1_000_000)
    rate_limit_login_account_per_15min: int = Field(default=10, ge=1, le=1_000_000)
    rate_limit_register_ip_per_hour: int = Field(default=20, ge=1, le=1_000_000)
    rate_limit_refresh_per_minute: int = Field(default=30, ge=1, le=1_000_000)
    rate_limit_password_reset_ip_per_hour: int = Field(default=10, ge=1, le=1_000_000)
    rate_limit_password_reset_account_per_hour: int = Field(default=3, ge=1, le=1_000_000)
    rate_limit_client_events_ip_per_minute: int = Field(default=30, ge=1, le=1_000_000)

    # NIST SP 800-63B §5.1.1.2: a new password is checked against common and breached ones —
    # always against the list built in; with this on, also against Have I Been Pwned's range
    # API (only the first five hex digits of the password's SHA-1 leave the server)
    hibp_enabled: bool = False
    hibp_timeout_s: float = Field(default=2.0, gt=0, le=10)

    # the web app keeps its refresh token in an httpOnly cookie instead of the response body
    # (frontend DECISIONS F8); off unless the web app and the API share a site
    web_refresh_cookie: bool = False

    # learner policy
    supported_l1: CsvList = Field(default_factory=lambda: ["uz", "ru"])

    # the AI conversation partner (docs/16 E21): off unless a key is configured
    ai_api_key: SecretStr | None = None
    ai_model: str = Field(default="claude-opus-5-5", pattern=r"^[a-z0-9][a-z0-9.-]{1,63}$")
    ai_effort: Literal["low", "medium", "high"] = "low"
    ai_fallbacks: bool = True
    ai_timeout_s: float = Field(default=45.0, gt=0, le=300)
    ai_daily_conversations: int = Field(default=5, ge=1, le=100)
    ai_max_turns: int = Field(default=12, ge=2, le=40)
    #: a uniform per-learner daily ceiling on model tokens (input + output), never sold
    ai_daily_token_budget: int = Field(default=400_000, ge=10_000, le=100_000_000)
    ai_retention_days: int = Field(default=30, ge=1, le=365)

    @field_validator("cors_origins", "supported_l1", mode="before")
    @classmethod
    def _csv(cls, value: Any) -> Any:
        return _split_csv(value)

    @field_validator("cors_origins")
    @classmethod
    def _origins(cls, origins: list[str]) -> list[str]:
        for origin in origins:
            if origin == "*":
                raise ValueError("a wildcard origin is not allowed; list each origin explicitly")
            parts = urlsplit(origin)
            if (
                parts.scheme not in ("http", "https")
                or not parts.netloc
                or parts.path not in ("", "/")
                or parts.query
                or parts.fragment
            ):
                raise ValueError("each origin must look like https://app.example.com[:port]")
        return [origin.rstrip("/") for origin in origins]

    @field_validator("supported_l1")
    @classmethod
    def _language_tags(cls, tags: list[str]) -> list[str]:
        if not tags:
            raise ValueError("at least one first language must be supported")
        for tag in tags:
            if not _LANGUAGE_TAG.fullmatch(tag):
                raise ValueError("each entry must be a language tag such as uz, ru or uz-Latn")
        return list(dict.fromkeys(tags))

    @field_validator("jwt_secret", "jwt_previous_secret")
    @classmethod
    def _strong_key(cls, secret: SecretStr | None) -> SecretStr | None:
        if secret is not None and len(secret.get_secret_value().encode()) < JWT_MIN_SECRET_BYTES:
            raise ValueError(f"must be at least {JWT_MIN_SECRET_BYTES} bytes of random data")
        return secret

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        _require_database_tls(self.env, self.db_ssl_mode)
        _require_redis_auth(self.env, self.redis_password)
        _require_metrics_token(self.env, self.metrics_token)
        _require_mail(self, self.env)
        if (
            self.env == "prod"
            and self.web_refresh_cookie
            and any(not o.startswith("https://") for o in self.cors_origins)
        ):
            raise ValueError(
                "with LEP_WEB_REFRESH_COOKIE in prod, every LEP_CORS_ORIGINS entry must be https"
            )
        if (
            self.jwt_previous_secret is not None
            and self.jwt_previous_secret.get_secret_value() == self.jwt_secret.get_secret_value()
        ):
            raise ValueError("LEP_JWT_PREVIOUS_SECRET must differ from LEP_JWT_SECRET")
        if self.session_max_age_s < self.refresh_token_ttl_s:
            raise ValueError("LEP_SESSION_MAX_AGE_S must be at least LEP_REFRESH_TOKEN_TTL_S")
        if self.env != "test" and (
            self.argon2_memory_kib < ARGON2_MIN_MEMORY_KIB
            or self.argon2_time_cost < ARGON2_MIN_TIME_COST
        ):
            raise ValueError(
                f"Argon2id parameters are below the OWASP minimum "
                f"(memory {ARGON2_MIN_MEMORY_KIB} KiB, time cost {ARGON2_MIN_TIME_COST}); "
                "cheaper parameters are allowed only when LEP_ENV=test"
            )
        return self

    @property
    def openapi_enabled(self) -> bool:
        """Interactive docs default to on everywhere except production."""
        return self.docs_enabled if self.docs_enabled is not None else self.env != "prod"


class WorkerSettings(
    CommonSettings, DatabaseSettings, RedisSettings, ContentSettings, MediaSettings
):
    """The Celery worker and beat. Deliberately has no access to the JWT key."""

    db_user: str = Field(min_length=1, max_length=63)
    db_password: SecretStr
    celery_task_time_limit_s: int = Field(default=600, ge=10, le=86_400)
    auth_session_retention_days: int = Field(default=30, ge=1, le=3_650)

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        _require_database_tls(self.env, self.db_ssl_mode)
        _require_redis_auth(self.env, self.redis_password)
        return self


class MigrationSettings(CommonSettings, DatabaseSettings):
    """Alembic. Connects as the schema owner; the API never holds these credentials."""

    db_migrator_user: str = Field(min_length=1, max_length=63)
    db_migrator_password: SecretStr

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        _require_database_tls(self.env, self.db_ssl_mode)
        return self


def describe_validation_error(exc: ValidationError) -> str:
    """Render a settings error as one line per variable, without any input values."""
    lines = []
    for error in exc.errors(include_url=False, include_context=False, include_input=False):
        loc = error["loc"]
        name = f"{ENV_PREFIX}{str(loc[0]).upper()}" if loc else "configuration"
        message = error["msg"].removeprefix("Value error, ")
        lines.append(f"{name}: {message}")
    return "invalid configuration:\n  " + "\n  ".join(lines)


def load_settings[SettingsT: _SettingsBase](cls: type[SettingsT]) -> SettingsT:
    """Load ``cls`` from the environment and the secrets directory, or raise ConfigError."""
    secrets_dir = Path(os.environ.get(SECRETS_DIR_ENV, str(DEFAULT_SECRETS_DIR)))
    try:
        if secrets_dir.is_dir():
            return cls(_secrets_dir=secrets_dir)
        return cls()
    except ValidationError as exc:
        raise ConfigError(describe_validation_error(exc)) from None
