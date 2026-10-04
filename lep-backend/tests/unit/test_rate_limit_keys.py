"""Rate-limit bucket keys: IPv6 per /64, and per-account keys never finer than the database."""

from __future__ import annotations

import pytest

from app.deps import rate_limit_ip_key
from app.schemas.auth import RegisterRequest, normalise_login_email, rate_limit_key_for_email
from tests.factories import registration


@pytest.mark.parametrize(
    ("host", "key"),
    [
        ("203.0.113.7", "203.0.113.7"),
        ("::ffff:203.0.113.7", "203.0.113.7"),
        ("2001:db8:1:2:aaaa::1", "2001:db8:1:2::/64"),
        ("2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:db8:1:2::/64"),
        ("unknown", "unknown"),
    ],
)
def test_ip_buckets(host: str, key: str) -> None:
    assert rate_limit_ip_key(host) == key


def test_two_addresses_in_one_ipv6_64_share_a_bucket() -> None:
    assert rate_limit_ip_key("2001:db8::1") == rate_limit_ip_key("2001:db8::ffff:1")
    assert rate_limit_ip_key("2001:db8::1") != rate_limit_ip_key("2001:db8:0:1::1")


def test_the_account_key_merges_spellings_the_database_treats_as_one() -> None:
    # citext under libc lowers U+0130 to "i"; Python's casefold keeps a combining dot.
    assert rate_limit_key_for_email("admİn@example.com") == rate_limit_key_for_email(
        "admin@example.com"
    )
    assert rate_limit_key_for_email("Learner@Example.com") == "learner@example.com"


def test_login_looks_up_the_registered_normalisation() -> None:
    assert normalise_login_email("  user@xn--bcher-kva.example ") == "user@bücher.example"
    assert normalise_login_email("not an email") == "not an email"


def test_registration_never_strips_the_password() -> None:
    body = registration(password="  spaced pass phrase  ", email=" a.learner@example.com ")
    request = RegisterRequest.model_validate(body)
    assert request.password.get_secret_value() == "  spaced pass phrase  "
    assert request.email == "a.learner@example.com"
