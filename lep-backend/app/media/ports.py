"""Speech and voice providers behind ports (backend brief §10).

No provider is wired in yet: which TTS voice, which acoustic model for alignment and GOP and which
independent ASR are product decisions (voice quality below C1 needs human recordings anyway,
docs/15 §5; speech data residency for Uzbekistan; cost). Every call goes through the server, so a
provider key can never reach a client, and with ``LEP_TTS_PROVIDER`` / ``LEP_SPEECH_PROVIDER`` at
``none`` the features report themselves unavailable instead of pretending.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.domain.pronunciation import Measurement


class ProviderUnavailable(RuntimeError):
    """The provider could not answer now; nothing was charged and nothing was stored."""


@dataclass(frozen=True, slots=True)
class Synthesised:
    audio: bytes
    mime: str
    duration_ms: int


class TtsEngine(Protocol):
    #: recorded on every asset it makes (provider, voice, model)
    version: str

    async def synthesise(self, text: str) -> Synthesised: ...


class SpeechScorer(Protocol):
    version: str

    async def measure(self, audio: bytes, mime: str, expected: str | None) -> Measurement:
        """Forced alignment against ``expected`` (GOP per phone, stress, timings) plus an
        independent ASR pass with no prior on the expected text. ``expected`` is None for free
        speech: then only the transcript and the timings are meaningful, ``words`` may be empty,
        and ``independent_wer`` is the disagreement between two independent ASR passes — the
        intelligibility proxy that free speech has."""
        ...
