"""Token-bucket rate limiting in Redis.

Each limit is a bucket of ``capacity`` tokens refilled evenly over ``window_s``: bursts
up to the capacity are allowed, and the sustained rate is capacity per window. The
bucket update is one Lua script, so it is atomic across API instances, and it reads
time from the Redis server, so instances with drifting clocks share one timeline.

Identities (an IP address, an email) are hashed before they become keys, so Redis
never holds a learner's email in plain text. Keys expire once a bucket would be full.

When Redis cannot be reached the caller chooses: ``fail_open`` lets the request
through (general traffic), otherwise the request gets a 503 (sign-in and
registration, where an outage must not open the door to password guessing).
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.errors import DependencyUnavailable, RateLimited
from app.observability.logs import get_logger
from app.observability.metrics import Metrics

KEY_PREFIX = "lep:rl"

_BUCKET_SCRIPT = """
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end
tokens = math.min(capacity, tokens + math.max(0, now - ts) * rate)
local allowed = 0
local retry_after_ms = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry_after_ms = math.ceil((cost - tokens) / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil((capacity - tokens) / rate) + 1000)
return {allowed, tostring(tokens), retry_after_ms}
"""

_log = get_logger("app.rate_limit")


@dataclass(frozen=True, slots=True)
class Limit:
    name: str
    capacity: int
    window_s: int

    @property
    def tokens_per_ms(self) -> float:
        return self.capacity / (self.window_s * 1000)


@dataclass(frozen=True, slots=True)
class Decision:
    allowed: bool
    remaining: int
    retry_after_s: int


class RateLimiter:
    def __init__(self, redis: Redis, metrics: Metrics) -> None:
        self._script = redis.register_script(_BUCKET_SCRIPT)
        self._metrics = metrics

    @staticmethod
    def key(limit: Limit, identity: str) -> str:
        digest = hashlib.sha256(f"{limit.name}\x00{identity}".encode()).hexdigest()[:32]
        return f"{KEY_PREFIX}:{limit.name}:{digest}"

    async def hit(self, limit: Limit, identity: str, *, cost: int = 1) -> Decision:
        allowed, tokens, retry_after_ms = await self._script(
            keys=[self.key(limit, identity)],
            args=[limit.capacity, repr(limit.tokens_per_ms), cost],
        )
        remaining = math.floor(float(tokens.decode() if isinstance(tokens, bytes) else tokens))
        if int(allowed) == 1:
            return Decision(allowed=True, remaining=remaining, retry_after_s=0)
        return Decision(
            allowed=False,
            remaining=remaining,
            retry_after_s=max(1, math.ceil(int(retry_after_ms) / 1000)),
        )

    async def enforce(self, limit: Limit, identity: str, *, fail_open: bool) -> None:
        """Raise RateLimited when over the limit; apply the fail policy if Redis is down."""
        try:
            decision = await self.hit(limit, identity)
        except (RedisError, OSError) as exc:
            outcome = "allowed" if fail_open else "rejected"
            self._metrics.rate_limiter_errors.labels(limit=limit.name, outcome=outcome).inc()
            _log.warning(
                "rate_limiter_unavailable",
                limit=limit.name,
                outcome=outcome,
                error_type=type(exc).__name__,
            )
            if fail_open:
                return
            raise DependencyUnavailable(
                "Sign-in is briefly unavailable; please retry shortly."
            ) from exc
        if not decision.allowed:
            self._metrics.rate_limited.labels(limit=limit.name).inc()
            raise RateLimited(retry_after_s=decision.retry_after_s)
