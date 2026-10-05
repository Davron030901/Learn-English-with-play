"""Quality control for recorded audio masters (docs/00 §6; backend brief §10.1). Pure.

Targets: 48 kHz mono, integrated loudness -16 LUFS ± 1, no clipping, silence trimmed. Loudness is
ITU-R BS.1770-4: K-weighting (a high-shelf and a high-pass biquad), mean square in 400 ms blocks
with 75 % overlap, an absolute gate at -70 LUFS and a relative gate 10 LU below. The size target
(≤ 60 kB per short item at Opus 24 kbps) is checked on the encoded file's length.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

SAMPLE_RATE: Final = 48_000
TARGET_LUFS: Final = -16.0
LUFS_TOLERANCE: Final = 1.0
#: a sample at or above this magnitude (full scale = 1.0) counts as clipped
CLIP_LEVEL: Final = 0.999
#: leading or trailing silence longer than this means it was not trimmed
MAX_EDGE_SILENCE_S: Final = 0.30
SILENCE_DBFS: Final = -50.0
MAX_ENCODED_BYTES: Final = 60_000

# BS.1770-4 K-weighting coefficients at 48 kHz
_SHELF_B: Final = (1.53512485958697, -2.69169618940638, 1.19839281085285)
_SHELF_A: Final = (1.0, -1.69065929318241, 0.73248077421585)
_HPF_B: Final = (1.0, -2.0, 1.0)
_HPF_A: Final = (1.0, -1.99004745483398, 0.99007225036621)


def _biquad(
    x: Sequence[float], b: tuple[float, float, float], a: tuple[float, float, float]
) -> list[float]:
    y: list[float] = []
    x1 = x2 = y1 = y2 = 0.0
    for s in x:
        out = b[0] * s + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
        x2, x1 = x1, s
        y2, y1 = y1, out
        y.append(out)
    return y


def integrated_loudness(samples: Sequence[float], rate: int = SAMPLE_RATE) -> float:
    """BS.1770-4 integrated loudness in LUFS of a mono signal (-inf for silence)."""
    if rate != SAMPLE_RATE:
        raise ValueError("loudness is measured on 48 kHz masters")
    k = _biquad(_biquad(samples, _SHELF_B, _SHELF_A), _HPF_B, _HPF_A)
    block = int(0.4 * rate)
    step = int(0.1 * rate)
    powers: list[float] = []
    for start in range(0, max(0, len(k) - block) + 1, step):
        seg = k[start : start + block]
        if len(seg) < block:
            break
        powers.append(sum(v * v for v in seg) / block)
    if not powers:
        return -math.inf

    def lufs(p: float) -> float:
        return -0.691 + 10 * math.log10(p) if p > 0 else -math.inf

    gated = [p for p in powers if lufs(p) > -70.0]
    if not gated:
        return -math.inf
    relative = lufs(sum(gated) / len(gated)) - 10.0
    final = [p for p in gated if lufs(p) > relative]
    return lufs(sum(final) / len(final)) if final else -math.inf


def _edge_silence_s(samples: Sequence[float], rate: int) -> tuple[float, float]:
    threshold = 10 ** (SILENCE_DBFS / 20)
    first = next((i for i, v in enumerate(samples) if abs(v) > threshold), len(samples))
    last = next((i for i, v in enumerate(reversed(samples)) if abs(v) > threshold), len(samples))
    return first / rate, last / rate


@dataclass(frozen=True, slots=True)
class QcReport:
    passed: bool
    problems: tuple[str, ...]
    loudness_lufs: float
    peak: float
    duration_s: float


def check(
    samples: Sequence[float], *, rate: int, channels: int, encoded_bytes: int | None = None
) -> QcReport:
    problems: list[str] = []
    if rate != SAMPLE_RATE:
        problems.append(f"sample rate {rate} Hz, expected {SAMPLE_RATE}")
    if channels != 1:
        problems.append(f"{channels} channels, expected mono")
    peak = max((abs(v) for v in samples), default=0.0)
    if peak >= CLIP_LEVEL:
        problems.append("clipping")
    loudness = integrated_loudness(samples, rate) if rate == SAMPLE_RATE else -math.inf
    if not abs(loudness - TARGET_LUFS) <= LUFS_TOLERANCE:
        problems.append(
            f"loudness {loudness:.1f} LUFS, expected {TARGET_LUFS:.0f} ± {LUFS_TOLERANCE:.0f}"
        )
    head, tail = _edge_silence_s(samples, rate)
    if head > MAX_EDGE_SILENCE_S or tail > MAX_EDGE_SILENCE_S:
        problems.append("silence not trimmed")
    if encoded_bytes is not None and encoded_bytes > MAX_ENCODED_BYTES:
        problems.append(f"encoded size {encoded_bytes} B over {MAX_ENCODED_BYTES}")
    return QcReport(
        not problems, tuple(problems), round(loudness, 2), round(peak, 4), len(samples) / rate
    )
