"""Identifiers.

Public row ids are UUIDv7 (RFC 9562 §5.7): a 48-bit Unix-millisecond timestamp
followed by random bits. They sort by creation time, so new rows append to the right
of a B-tree index instead of landing on random pages, and they cannot be enumerated.
Python 3.12 has no ``uuid.uuid7``; this is a direct implementation of the layout.
"""

from __future__ import annotations

import os
import time
import uuid

_TIMESTAMP_MASK = (1 << 48) - 1
_RAND_A_MASK = (1 << 12) - 1
_RAND_B_MASK = (1 << 62) - 1


def uuid7(unix_ms: int | None = None) -> uuid.UUID:
    """A version-7 UUID. ``unix_ms`` fixes the timestamp (tests); otherwise it is now."""
    ms = time.time_ns() // 1_000_000 if unix_ms is None else unix_ms
    if not 0 <= ms <= _TIMESTAMP_MASK:
        raise ValueError("timestamp out of range for UUIDv7")
    rand = int.from_bytes(os.urandom(10), "big")
    rand_a = (rand >> 62) & _RAND_A_MASK
    rand_b = rand & _RAND_B_MASK
    value = (ms << 80) | (0x7 << 76) | (rand_a << 64) | (0b10 << 62) | rand_b
    return uuid.UUID(int=value)


def uuid7_unix_ms(value: uuid.UUID) -> int:
    """The millisecond timestamp embedded in a UUIDv7."""
    if value.version != 7:
        raise ValueError("not a version-7 UUID")
    return value.int >> 80


class Uuid7Sequence:
    """UUIDv7s that strictly increase in the order they are made, even within one millisecond:
    the 12 ``rand_a`` bits carry a counter (RFC 9562 §6.2, method 1). Rows written in one batch
    therefore sort in the order they were applied, which replay relies on."""

    def __init__(self) -> None:
        self._ms = -1
        self._counter = 0

    def next(self, unix_ms: int | None = None) -> uuid.UUID:
        ms = time.time_ns() // 1_000_000 if unix_ms is None else unix_ms
        if ms <= self._ms:
            ms = self._ms
            self._counter += 1
            if self._counter > _RAND_A_MASK:
                ms += 1
                self._counter = 0
        else:
            self._counter = 0
        self._ms = ms
        if not 0 <= ms <= _TIMESTAMP_MASK:
            raise ValueError("timestamp out of range for UUIDv7")
        rand_b = int.from_bytes(os.urandom(8), "big") & _RAND_B_MASK
        value = (ms << 80) | (0x7 << 76) | (self._counter << 64) | (0b10 << 62) | rand_b
        return uuid.UUID(int=value)
