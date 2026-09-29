from __future__ import annotations

import time

import pytest

from app.ids import uuid7, uuid7_unix_ms


def test_uuid7_has_the_rfc_9562_version_and_variant() -> None:
    value = uuid7()
    assert value.version == 7
    assert value.variant == "specified in RFC 4122"


def test_uuid7_embeds_the_millisecond_timestamp() -> None:
    before = time.time_ns() // 1_000_000
    value = uuid7()
    after = time.time_ns() // 1_000_000
    assert before <= uuid7_unix_ms(value) <= after
    assert uuid7_unix_ms(uuid7(unix_ms=1_758_790_800_000)) == 1_758_790_800_000


def test_uuid7_sorts_by_creation_time_across_milliseconds() -> None:
    earlier = uuid7(unix_ms=1_000)
    later = uuid7(unix_ms=1_001)
    assert earlier < later
    assert str(earlier) < str(later)


def test_uuid7_is_unique_within_one_millisecond() -> None:
    assert len({uuid7(unix_ms=42) for _ in range(10_000)}) == 10_000


def test_uuid7_rejects_out_of_range_timestamps() -> None:
    with pytest.raises(ValueError, match="out of range"):
        uuid7(unix_ms=-1)
    with pytest.raises(ValueError, match="out of range"):
        uuid7(unix_ms=1 << 48)
