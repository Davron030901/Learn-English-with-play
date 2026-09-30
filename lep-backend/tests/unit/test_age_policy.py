from __future__ import annotations

from datetime import date

import pytest

from app.domain.age_policy import (
    AgeRange,
    InvalidBirthYear,
    is_minor,
    meets_minimum_age,
    possible_ages,
)

TODAY = date(2026, 9, 25)


def test_a_birth_year_leaves_a_one_year_range_of_possible_ages() -> None:
    assert possible_ages(2000, TODAY) == AgeRange(youngest=25, oldest=26)
    assert possible_ages(2026, TODAY) == AgeRange(youngest=0, oldest=0)


@pytest.mark.parametrize(
    ("birth_year", "allowed"),
    [
        (2012, True),  # 13 or 14: certainly 13+
        (2013, False),  # 12 or 13: might be 12 — refused (conservative reading)
        (2014, False),
        (1950, True),
    ],
)
def test_registration_requires_a_learner_who_is_certainly_13_or_older(
    birth_year: int, allowed: bool
) -> None:
    assert meets_minimum_age(birth_year, TODAY) is allowed


@pytest.mark.parametrize(
    ("birth_year", "minor"),
    [
        (2009, True),  # 16 or 17
        (2008, True),  # 17 or 18: might be 17 — protected as a minor
        (2007, False),  # 18 or 19
    ],
)
def test_minor_protections_apply_while_the_learner_might_be_under_18(
    birth_year: int, minor: bool
) -> None:
    assert is_minor(birth_year, TODAY) is minor


def test_minor_status_is_derived_so_it_lapses_without_a_write() -> None:
    assert is_minor(2008, date(2026, 12, 31)) is True
    assert is_minor(2008, date(2027, 1, 1)) is False


@pytest.mark.parametrize("birth_year", [2027, 1899])
def test_implausible_birth_years_are_rejected(birth_year: int) -> None:
    with pytest.raises(InvalidBirthYear):
        possible_ages(birth_year, TODAY)
