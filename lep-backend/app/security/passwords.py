"""Argon2id password hashing.

Hashing is deliberately slow and memory-hard, so it runs in worker threads (the
argon2 C code releases the GIL) behind a capacity limiter: at most
``LEP_PASSWORD_HASH_CONCURRENCY`` hashes run at once, which bounds memory at
concurrency × ``LEP_ARGON2_MEMORY_KIB`` however many logins arrive together.

A login for an unknown email verifies against a dummy hash, so it costs the same time
as a login with a wrong password and the response time does not reveal which emails
are registered.
"""

from __future__ import annotations

import secrets

import anyio
import anyio.to_thread
from argon2 import PasswordHasher as _Argon2Hasher
from argon2 import Type
from argon2.exceptions import InvalidHashError, VerificationError
from pydantic import SecretStr


class PasswordHasher:
    def __init__(
        self, *, time_cost: int, memory_kib: int, parallelism: int, max_concurrency: int
    ) -> None:
        self._argon2 = _Argon2Hasher(
            time_cost=time_cost,
            memory_cost=memory_kib,
            parallelism=parallelism,
            hash_len=32,
            salt_len=16,
            type=Type.ID,
        )
        self._limiter = anyio.CapacityLimiter(max_concurrency)
        self._dummy_hash: str | None = None

    async def hash(self, password: SecretStr) -> str:
        return await anyio.to_thread.run_sync(
            self._argon2.hash, password.get_secret_value(), limiter=self._limiter
        )

    async def verify(self, password_hash: str | None, password: SecretStr) -> bool:
        """Check ``password``; with no stored hash, do the same work and return False."""
        target = password_hash if password_hash is not None else await self._dummy()
        try:
            await anyio.to_thread.run_sync(
                self._argon2.verify, target, password.get_secret_value(), limiter=self._limiter
            )
        except (VerificationError, InvalidHashError):
            return False
        return password_hash is not None

    def needs_rehash(self, password_hash: str) -> bool:
        """True when the hash was made with parameters other than the current ones."""
        try:
            return self._argon2.check_needs_rehash(password_hash)
        except InvalidHashError:
            return True

    async def warm_up(self) -> None:
        """Compute the dummy hash at startup instead of during the first failed login."""
        await self._dummy()

    async def _dummy(self) -> str:
        if self._dummy_hash is None:
            self._dummy_hash = await self.hash(SecretStr(secrets.token_urlsafe(24)))
        return self._dummy_hash
