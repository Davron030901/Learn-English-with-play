"""The new-password screen (R14), the reset letter, and the mail configuration."""

# ruff: noqa: RUF001 — the Uzbek and Russian copy uses its own letters on purpose

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr

from app.config import ConfigError, Settings
from app.mail import FileMailer, SmtpMailer, build_mailer
from app.mail.ports import Message
from app.observability.metrics import Metrics
from app.security.breached import PasswordScreen, local_reason
from app.services.passwords import reset_link, reset_message
from tests.factories import make_settings


@pytest.mark.parametrize(
    ("password", "reason"),
    [
        ("1234567890", "common"),
        ("Password1234", "common"),
        ("password2024!", "common"),
        ("  QWERTY!!!!123  ", "common"),
        ("iloveyou123", "common"),
        ("aaaaaaaaaaaa", "pattern"),
        ("abababababab", "pattern"),
        ("abcdefghijklm", "pattern"),
        ("zyxwvutsrqpo", "pattern"),
        ("asdfghjklzxc", "pattern"),
        ("learnenglish12", "context"),
        ("LearnEnglish2026", "context"),
        ("correct horse battery staple", None),
        ("839201746583", None),
        ("tashkent in the spring rain", None),
    ],
)
def test_the_built_in_checks(password: str, reason: str | None) -> None:
    assert local_reason(password) == reason


def test_a_password_holding_the_whole_email_address_is_refused() -> None:
    for email in ("alice@gmail.com", "ab@example.com", "Dilnoza.Karimova@example.uz"):
        assert local_reason(email, email) == "context"
        assert local_reason(email.upper() + " 2026", email) == "context"


def test_a_password_little_more_than_the_email_name_is_refused() -> None:
    assert local_reason("dilnoza.karimova1", "Dilnoza.Karimova@example.uz") == "context"
    assert local_reason("dilnoza loves green tea", "dilnoza@example.uz") is None
    assert local_reason("ali.tea.garden", "ali@example.uz") is None, "a short name is no rule"


def _range_with(password: str, count: int) -> str:
    digest = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
    return f"0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n{digest[5:]}:{count}\r\nFFFF:0"


async def test_the_range_api_finds_a_breached_password_and_never_sees_it() -> None:
    seen: list[str] = []
    password = "correct horse battery staple"

    async def lookup(prefix: str) -> str:
        seen.append(prefix)
        return _range_with(password, 3_000)

    screen = PasswordScreen(Metrics(), lookup)
    assert await screen.check(SecretStr(password)) == "breached"
    assert seen == [hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()[:5]]
    assert await screen.check(SecretStr("a different long passphrase")) is None


async def test_a_padding_entry_is_not_a_breach_and_an_outage_fails_open() -> None:
    password = "a long and unusual passphrase"

    async def padded(_: str) -> str:
        return _range_with(password, 0)

    assert await PasswordScreen(Metrics(), padded).check(SecretStr(password)) is None

    async def down(_: str) -> str:
        raise TimeoutError

    metrics = Metrics()
    assert await PasswordScreen(metrics, down).check(SecretStr(password)) is None
    assert metrics.password_screen.labels(outcome="lookup_failed")._value.get() == 1
    assert metrics.password_screen.labels(outcome="accepted")._value.get() == 1


def test_the_letter_is_in_the_learners_language_then_english() -> None:
    link = reset_link("https://app.example.org/reset-password", "tok_123")
    assert link == "https://app.example.org/reset-password?token=tok_123"
    uz = reset_message("a@example.uz", "uz", link, 30)
    assert uz.subject == "Learn English with Play parolini tiklash"
    assert uz.text.index("30 daqiqa") < uz.text.index("within 30 minutes")
    assert uz.text.count(link) == 2
    ru = reset_message("a@example.ru", "ru-RU", link, 30)
    assert ru.subject.startswith("Сброс пароля")
    en = reset_message("a@example.com", "de", link, 15)
    assert en.subject == "Reset your Learn English with Play password"
    assert "within 15 minutes" in en.text
    assert "daqiqa" not in en.text


def _mail(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "mail_backend": "smtp",
        "smtp_host": "smtp.example.org",
        "mail_from": "Learn English <no-reply@example.org>",
        "password_reset_url": "https://app.example.org/reset-password",
    }
    values.update(overrides)
    return make_settings(**values)


def test_mail_configuration_is_checked_before_start() -> None:
    assert isinstance(build_mailer(_mail()), SmtpMailer)
    assert build_mailer(make_settings()) is None
    for bad in (
        {"smtp_host": None},
        {"mail_from": None},
        {"password_reset_url": None},
        {"password_reset_url": "https://app.example.org/reset?x=1"},
        {"password_reset_url": "ftp://app.example.org/reset"},
        {"env": "prod", "smtp_tls": "none"},
        {"env": "prod", "mail_backend": "file"},
        {"env": "prod", "password_reset_url": "http://app.example.org/reset"},
    ):
        with pytest.raises((ConfigError, ValueError)):
            _mail(**bad)
    assert _mail(password_reset_url="lep://reset-password") is not None, "outside prod only"
    with pytest.raises((ConfigError, ValueError)):
        _mail(env="prod", password_reset_url="lep://reset-password")
    with pytest.raises((ConfigError, ValueError)):
        _mail(smtp_username="relay-user")  # a username without a password is never sent
    with pytest.raises((ConfigError, ValueError)):
        make_settings(env="prod", web_refresh_cookie=True, cors_origins=["http://app.example.org"])


async def test_the_file_mailer_writes_a_private_eml(tmp_path: Path) -> None:
    mailer = build_mailer(_mail(mail_backend="file", mail_outbox_dir=tmp_path / "out"))
    assert isinstance(mailer, FileMailer)
    await mailer.send(Message(to="a@example.org", subject="Hi", text="Hello ʻ world\n"))
    (eml,) = (tmp_path / "out").glob("*.eml")
    assert b"Subject: Hi" in eml.read_bytes()


def test_the_smtp_message_is_plain_text_and_marked_automatic() -> None:
    mailer = build_mailer(_mail())
    assert isinstance(mailer, SmtpMailer)
    built = mailer.build(Message(to="a@example.org", subject="Hi", text="Hello\n"))
    assert built["Auto-Submitted"] == "auto-generated"
    assert built.get_content_type() == "text/plain"
    assert built["Message-ID"].endswith("@example.org>")
