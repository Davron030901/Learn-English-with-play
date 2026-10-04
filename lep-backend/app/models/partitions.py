"""Partition naming for the append-only review tables (docs/ERD.md, "review_log").

``review_attempts`` and ``review_log`` are range-partitioned by month on ``ts``; ``memory_state``
is hash-partitioned by learner into 64. The partitions are created by migrations and by the
partition-maintenance task, never by the models, so schema comparison must skip them.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Final

MONTHLY_TABLES: Final = ("review_attempts", "review_log")
MEMORY_STATE_PARTITIONS: Final = 64

_CHILD = re.compile(
    r"^(?:(?:review_attempts|review_log)_(?:\d{4}_\d{2}|default)|memory_state_p\d{2})$"
)


def is_partition_child(table_name: str) -> bool:
    return bool(_CHILD.fullmatch(table_name))


def month_partition(table: str, month: date) -> tuple[str, date, date]:
    """(name, from, to) of the monthly partition holding ``month``."""
    start = month.replace(day=1)
    end = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
    return f"{table}_{start:%Y_%m}", start, end


def months_from(first: date, count: int) -> list[date]:
    out: list[date] = []
    y, m = first.year, first.month
    for _ in range(count):
        out.append(date(y, m, 1))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def include_name(name: str | None, type_: str, _parents: object) -> bool:
    """Alembic ``include_name`` hook: partitions are not described by the models."""
    return not (type_ == "table" and name is not None and is_partition_child(name))
