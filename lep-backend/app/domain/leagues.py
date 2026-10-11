"""Opt-in weekly leagues (docs/10 §6, docs/16 E23) — the pure rules.

A league is a weekly XP ladder of at most 30 learners of one tier (1 Clay … 10 Diamond). It is
off by default and never for a learner who might be a minor (docs/10 §8.8). Only XP from
scheduled work and immersion counts — a re-grind earns none — so farming replays does not help.

* **The week** ends at a fixed, stated time for everyone: Sunday 20:00 in Tashkent (UTC+5, no
  daylight saving), so every week is exactly seven days.
* **Groups** are formed when an opted-in learner first earns XP in a week: the group of their
  tier whose seed (its first member's XP the week before) is within ±50 % of their own, else the
  nearest one with room, else a new one — nobody races alone while a group of their tier has
  room.
* **Settlement**: the top 7 move up (never above 10, and only with some XP); from tier 3 the
  bottom 5 move down, never into the top 7 of a small group; tiers 1 and 2 have no demotion. A
  learner whose streak is paused at the end of the week has no movement.
* **Leaving** is one tap; the tier is kept for four weeks, then starts again at 1.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo

TIERS: Final = 10
LEAGUE_SIZE: Final = 30
PROMOTED: Final = 7
DEMOTED: Final = 5
#: tiers whose bottom places do not move down
NO_DEMOTION: Final = frozenset({1, 2})
#: how long a learner who left keeps their tier
TIER_KEPT: Final = timedelta(weeks=4)
#: how far a group's seed may be from a joining learner's last week (±50 %)
BAND: Final = 0.5

WEEK_ZONE: Final = ZoneInfo("Asia/Tashkent")
WEEK_ENDS_ON: Final = 6  # Sunday (date.weekday)
WEEK_ENDS_AT: Final = time(20, 0)
WEEK: Final = timedelta(days=7)


@dataclass(frozen=True, slots=True)
class Week:
    starts_at: datetime
    ends_at: datetime

    @property
    def last_day(self) -> date:
        """The Tashkent calendar day the week ends on (a Sunday)."""
        return self.ends_at.astimezone(WEEK_ZONE).date()


def week_of(at: datetime) -> Week:
    """The league week ``at`` falls in: [Sunday 20:00, next Sunday 20:00) in Tashkent."""
    local = at.astimezone(WEEK_ZONE)
    end_day = local.date() + timedelta(days=(WEEK_ENDS_ON - local.weekday()) % 7)
    end = datetime.combine(end_day, WEEK_ENDS_AT, tzinfo=WEEK_ZONE)
    if end <= local:
        end += WEEK
    ends_at = end.astimezone(UTC)
    return Week(ends_at - WEEK, ends_at)


def previous(week: Week) -> Week:
    return Week(week.starts_at - WEEK, week.starts_at)


# ------------------------------------------------------------------- grouping


@dataclass(frozen=True, slots=True)
class Group:
    id: object
    seed_xp: int
    members: int


def in_band(seed_xp: int, xp: int) -> bool:
    """Whether a learner with ``xp`` last week belongs with a group seeded at ``seed_xp``."""
    if seed_xp == 0:
        return xp == 0
    return (1 - BAND) * seed_xp <= xp <= (1 + BAND) * seed_xp


def choose_group(groups: Sequence[Group], last_week_xp: int) -> Group | None:
    """The group to join, or None when every group of the tier is full (start a new one).

    In band first, then the nearest seed; among equals the fuller group, so groups fill."""
    open_ = [g for g in groups if g.members < LEAGUE_SIZE]
    if not open_:
        return None

    def key(g: Group) -> tuple[bool, int, int]:
        return (not in_band(g.seed_xp, last_week_xp), abs(g.seed_xp - last_week_xp), -g.members)

    return min(open_, key=key)


# ------------------------------------------------------------------- standings and settlement


@dataclass(frozen=True, slots=True)
class Entry:
    learner_id: object
    xp_centi: int
    joined_at: datetime
    paused: bool = False


@dataclass(frozen=True, slots=True)
class Standing:
    learner_id: object
    rank: int
    xp_centi: int
    #: "up", "down" or None: where the learner would go if the week ended now
    zone: str | None
    #: +1, 0 or -1 — what settlement does (a paused learner does not move)
    moved: int


def zone(tier: int, rank: int, size: int, xp_centi: int) -> str | None:
    if rank <= PROMOTED and tier < TIERS and xp_centi > 0:
        return "up"
    if tier not in NO_DEMOTION and rank > max(PROMOTED, size - DEMOTED):
        return "down"
    return None


def standings(tier: int, entries: Sequence[Entry]) -> list[Standing]:
    """Ranked by weekly XP; on equal XP, whoever joined first ranks higher."""
    ordered = sorted(entries, key=lambda e: (-e.xp_centi, e.joined_at, str(e.learner_id)))
    out: list[Standing] = []
    for rank, e in enumerate(ordered, start=1):
        z = zone(tier, rank, len(ordered), e.xp_centi)
        moved = 0 if e.paused else {"up": 1, "down": -1}.get(z or "", 0)
        out.append(Standing(e.learner_id, rank, e.xp_centi, z, moved))
    return out


def tier_after(tier: int, moved: int) -> int:
    return min(TIERS, max(1, tier + moved))


def tier_on_return(tier: int, left_at: datetime | None, now: datetime) -> int:
    """The tier of a learner who joins again: kept for four weeks after leaving."""
    if left_at is not None and now - left_at > TIER_KEPT:
        return 1
    return tier


def xp(centi: int) -> int:
    """Whole XP for display, rounded half up — the same rounding as the award pipeline."""
    return (centi + 50) // 100
