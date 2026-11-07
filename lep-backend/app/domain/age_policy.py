"""Age rules for account creation and for minor protections.

* docs/00 §4.4: all content passes an age-appropriateness gate for 13+, and the
  separate Kids track (7–12) is not built — so an account is refused unless the learner
  is certainly 13 or older.
* docs/11 §10, quoted in the brief §9.3: under-18 accounts get no social matching and
  no ad personalisation.

Only the birth *year* is collected (data minimisation), so a learner's exact age is
uncertain by one year. Both rules take the conservative reading, recorded in
DECISIONS.md: refuse if the learner *might* be under 13, and protect as a minor if the
learner *might* be under 18. ``is_minor`` is derived on read, never stored, because a
stored flag goes stale on the learner's eighteenth birthday.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

MINIMUM_AGE = 13
ADULT_AGE = 18
EARLIEST_BIRTH_YEAR = 1900


class InvalidBirthYear(ValueError):
    """The birth year is in the future or implausibly far in the past."""


@dataclass(frozen=True, slots=True)
class AgeRange:
    youngest: int
    oldest: int


def possible_ages(birth_year: int, on: date) -> AgeRange:
    """Every age a person born in ``birth_year`` can have on ``on``."""
    if birth_year > on.year:
        raise InvalidBirthYear("birth year is in the future")
    if birth_year < EARLIEST_BIRTH_YEAR:
        raise InvalidBirthYear(f"birth year is before {EARLIEST_BIRTH_YEAR}")
    oldest = on.year - birth_year
    return AgeRange(youngest=max(oldest - 1, 0), oldest=oldest)


def meets_minimum_age(birth_year: int, on: date) -> bool:
    """True only if the learner is certainly at least ``MINIMUM_AGE``."""
    return possible_ages(birth_year, on).youngest >= MINIMUM_AGE


def is_minor(birth_year: int, on: date) -> bool:
    """True if the learner might be under ``ADULT_AGE``."""
    return possible_ages(birth_year, on).youngest < ADULT_AGE
