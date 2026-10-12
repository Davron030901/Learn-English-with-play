"""A new password is checked against common and breached ones (NIST SP 800-63B §5.1.1.2; R14).

Two layers, applied when a password is chosen — at registration, on a reset and on a change,
never at sign-in:

* **Always, built in:** the passwords breach corpora show most often (at the ten-character
  minimum this service enforces, shorter ones never get this far); a common word padded with
  digits or symbols; one character repeated; a run along the alphabet, the digits or a keyboard
  row; and a password that is little more than the email's name or the service's.
* **Optionally** (``LEP_HIBP_ENABLED``): Have I Been Pwned's Pwned Passwords range API, with
  k-anonymity — only the first five hex digits of the password's SHA-1 leave the server, with
  padding asked for so the response size says nothing either; the remaining digits are compared
  here. It fails open: an outage there must not stop a learner signing up. Each outcome is
  counted (``password_screen_total``) and a failure is logged without the password.

The password never appears in a log, an error or a metric.
"""

from __future__ import annotations

import asyncio
import hashlib
import urllib.request
from collections.abc import Awaitable, Callable
from typing import Final, Literal

from pydantic import SecretStr

from app.observability.logs import get_logger
from app.observability.metrics import Metrics

Reason = Literal["common", "pattern", "context", "breached"]

HIBP_RANGE_URL: Final = "https://api.pwnedpasswords.com/range/"
SERVICE_WORDS: Final = ("learnenglishwithplay", "learnenglish", "englishwithplay")
#: what is left once a context word is taken out must be at least this long
MIN_REST: Final = 6

#: the most frequent passwords of ten characters or more in public breach compilations
COMMON: Final = frozenset(
    {
        "1234567890",
        "0987654321",
        "12345678910",
        "123456789a",
        "1234567890a",
        "a123456789",
        "123456789q",
        "q123456789",
        "1q2w3e4r5t",
        "1q2w3e4r5t6y",
        "1qaz2wsx3edc",
        "qwertyuiop",
        "qwerty1234",
        "qwerty12345",
        "qwerty123456",
        "asdfghjkl1",
        "zxcvbnm123",
        "password12",
        "password123",
        "password1234",
        "password12345",
        "passw0rd123",
        "p@ssw0rd123",
        "iloveyou12",
        "iloveyou123",
        "iloveyou1234",
        "princess123",
        "football123",
        "baseball123",
        "basketball",
        "basketball1",
        "liverpool1",
        "manchester",
        "manchester1",
        "chocolate1",
        "sunshine123",
        "superman123",
        "starwars123",
        "welcome123",
        "welcome1234",
        "letmein123",
        "trustno1234",
        "michael123",
        "jessica123",
        "1111111111",
        "0000000000",
        "1212121212",
        "1122334455",
        "0123456789",
        "9876543210",
        "abcdefghij",
        "abcd123456",
        "abc1234567",
        "aaaaaaaaaa",
        "computer123",
        "internet123",
        "samsung123",
        "nokia12345",
        "uzbekistan",
        "uzbekistan1",
        "tashkent123",
        "toshkent123",
        "parol12345",
        "parol123456",
        "qwerty123qwerty",
        "secret1234",
        "changeme123",
        "administrator",
        "admin12345",
        "admin123456",
        "dragon1234",
        "monkey1234",
        "shadow1234",
        "master1234",
        "killer1234",
        "pokemon123",
        "naruto1234",
        "blink18218",
        "zaq12wsxcde",
        "1qazxsw23edc",
    }
)

#: common words that a padded password is usually built from ("password2024!")
COMMON_WORDS: Final = frozenset(
    {
        "password",
        "passw0rd",
        "p@ssw0rd",
        "qwerty",
        "qwertyuiop",
        "iloveyou",
        "letmein",
        "welcome",
        "admin",
        "administrator",
        "football",
        "baseball",
        "monkey",
        "dragon",
        "sunshine",
        "princess",
        "superman",
        "trustno1",
        "shadow",
        "master",
        "secret",
        "changeme",
        "computer",
        "internet",
        "english",
        "parol",
        "uzbekistan",
        "tashkent",
        "toshkent",
    }
)

#: runs a password may not simply walk along (forwards or backwards)
RUNS: Final = (
    "abcdefghijklmnopqrstuvwxyz",
    "01234567890",
    "qwertyuiopasdfghjklzxcvbnm",
    "1q2w3e4r5t6y7u8i9o0p",
    "1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p",
    "zaq12wsxcde34rfvbgt56yhnmju78ik,.lo90p",
)

_PADDING = "0123456789!@#$%^&*()-_=+.,?;:'\" "

#: what the learner reads when a new password is refused (never the password itself)
REFUSALS: Final[dict[Reason, str]] = {
    "common": "this password is one of the most common ones; choose another",
    "pattern": "this password is a simple pattern; choose another",
    "context": "this password is built from your email or the app's name; choose another",
    "breached": "this password has appeared in a data breach; choose another",
}

RangeLookup = Callable[[str], Awaitable[str]]

_log = get_logger("app.passwords")


def _fold(password: str) -> str:
    return password.casefold().strip()


def local_reason(password: str, email: str | None = None) -> Reason | None:
    """The built-in checks; no I/O."""
    p = _fold(password)
    if p in COMMON:
        return "common"
    if p.strip(_PADDING) in COMMON_WORDS:
        return "common"
    compact = p.replace(" ", "")
    if len(set(compact)) <= 2:
        return "pattern"
    for run in RUNS:
        if compact in run * 3 or compact in run[::-1] * 3:
            return "pattern"
    words = list(SERVICE_WORDS)
    if email:
        address = _fold(email)
        if address and address in compact:
            return "context"
        name = address.partition("@")[0]
        if len(name) >= 4:
            words.append(name)
    for word in words:
        if word in compact and len(compact.replace(word, "")) < MIN_REST:
            return "context"
    return None


async def hibp_range(prefix: str, *, timeout_s: float) -> str:
    """The Pwned Passwords range for a five-digit SHA-1 prefix, padded."""

    def fetch() -> str:
        request = urllib.request.Request(  # noqa: S310 — a fixed https URL
            HIBP_RANGE_URL + prefix,
            headers={"Add-Padding": "true", "User-Agent": "lep-backend"},
        )
        with urllib.request.urlopen(request, timeout=timeout_s) as response:  # noqa: S310
            body: bytes = response.read(4_000_000)
        return body.decode("ascii", errors="replace")

    return await asyncio.to_thread(fetch)


class PasswordScreen:
    def __init__(self, metrics: Metrics, lookup: RangeLookup | None = None) -> None:
        self._metrics = metrics
        self._lookup = lookup

    @property
    def remote(self) -> bool:
        return self._lookup is not None

    async def check(self, password: SecretStr, *, email: str | None = None) -> Reason | None:
        """Why this password should not be chosen, or None when it may be."""
        value = password.get_secret_value()
        reason = local_reason(value, email)
        if reason is None and self._lookup is not None:
            reason = await self._breached(value)
        self._metrics.password_screen.labels(outcome=reason or "accepted").inc()
        return reason

    async def _breached(self, value: str) -> Reason | None:
        if self._lookup is None:
            return None
        digest = hashlib.sha1(value.encode(), usedforsecurity=False).hexdigest().upper()
        prefix, suffix = digest[:5], digest[5:]
        try:
            body = await self._lookup(prefix)
        except Exception as exc:  # noqa: BLE001 — any failure there fails open, by design
            self._metrics.password_screen.labels(outcome="lookup_failed").inc()
            _log.warning("breached_password_lookup_failed", error_type=type(exc).__name__)
            return None
        for line in body.splitlines():
            head, _, count = line.partition(":")
            if head.strip().upper() == suffix:
                return "breached" if count.strip().isdigit() and int(count) > 0 else None
        return None


def build_screen(metrics: Metrics, *, hibp: bool, timeout_s: float) -> PasswordScreen:
    if not hibp:
        return PasswordScreen(metrics)

    async def lookup(prefix: str) -> str:
        return await hibp_range(prefix, timeout_s=timeout_s)

    return PasswordScreen(metrics, lookup)
