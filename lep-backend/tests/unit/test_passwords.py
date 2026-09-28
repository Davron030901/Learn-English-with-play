from __future__ import annotations

from pydantic import SecretStr

from app.security.passwords import PasswordHasher


def _hasher(**overrides: int) -> PasswordHasher:
    params = {"time_cost": 1, "memory_kib": 8, "parallelism": 1, "max_concurrency": 2}
    params.update(overrides)
    return PasswordHasher(**params)


async def test_should_verify_the_right_password_and_reject_a_wrong_one() -> None:
    hasher = _hasher()
    stored = await hasher.hash(SecretStr("correct horse battery staple"))

    assert stored.startswith("$argon2id$")
    assert await hasher.verify(stored, SecretStr("correct horse battery staple"))
    assert not await hasher.verify(stored, SecretStr("correct horse battery stapler"))


async def test_should_salt_every_hash() -> None:
    hasher = _hasher()
    password = SecretStr("same password twice")
    assert await hasher.hash(password) != await hasher.hash(password)


async def test_should_return_false_without_a_stored_hash_after_doing_the_same_work() -> None:
    hasher = _hasher()
    await hasher.warm_up()
    assert not await hasher.verify(None, SecretStr("anything at all"))


async def test_should_treat_a_corrupt_hash_as_a_failed_verification() -> None:
    hasher = _hasher()
    assert not await hasher.verify("not-a-hash", SecretStr("anything at all"))
    assert hasher.needs_rehash("not-a-hash")


async def test_should_ask_for_a_rehash_when_parameters_change() -> None:
    old = _hasher(time_cost=1)
    stored = await old.hash(SecretStr("upgrade me please"))
    assert not old.needs_rehash(stored)
    assert _hasher(time_cost=2).needs_rehash(stored)
