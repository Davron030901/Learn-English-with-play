"""Learner rows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import ColumnElement, cast, insert, select, update
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Learner, LearnerSettings


@dataclass(frozen=True, slots=True)
class NewLearner:
    id: UUID
    email: str
    password_hash: str
    l1: str
    birth_year: int
    tz: str
    daily_goal_min: int
    spelling_variant: str


@dataclass(frozen=True, slots=True)
class Credentials:
    learner_id: UUID
    password_hash: str
    status: str


@dataclass(frozen=True, slots=True)
class Profile:
    id: UUID
    email: str
    l1: str
    birth_year: int
    tz: str
    daily_goal_min: int
    status: str
    created_at: datetime
    desired_retention: Decimal
    rest_days: list[int]
    leagues_opt_in: bool
    perfectionist_mode: bool
    data_collection_paused: bool
    spelling_variant: str
    voice_consent: bool = False
    training_opt_in: bool = False
    a11y_no_audio: bool = False
    a11y_no_vision: bool = False
    display_name: str | None = None
    league_tier: int = 1
    leagues_left_at: datetime | None = None


def _email_equals(email: str) -> ColumnElement[bool]:
    # Cast the parameter so PostgreSQL compares citext to citext. Compared as text, the
    # column would be cast down instead and the match would become case-sensitive.
    return Learner.email == cast(email, CITEXT)


class LearnerRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def insert(self, learner: NewLearner) -> bool:
        """Insert the learner and default settings; False if the email is taken."""
        inserted = await self._session.execute(
            pg_insert(Learner)
            .values(
                id=learner.id,
                email=learner.email,
                password_hash=learner.password_hash,
                l1=learner.l1,
                birth_year=learner.birth_year,
                tz=learner.tz,
                daily_goal_min=learner.daily_goal_min,
            )
            .on_conflict_do_nothing(index_elements=[Learner.email])
            .returning(Learner.id)
        )
        if inserted.scalar_one_or_none() is None:
            return False
        await self._session.execute(
            insert(LearnerSettings).values(
                learner_id=learner.id, spelling_variant=learner.spelling_variant
            )
        )
        return True

    async def credentials(self, email: str) -> Credentials | None:
        row = (
            await self._session.execute(
                select(Learner.id, Learner.password_hash, Learner.status).where(
                    _email_equals(email)
                )
            )
        ).one_or_none()
        if row is None:
            return None
        return Credentials(learner_id=row.id, password_hash=row.password_hash, status=row.status)

    async def lock_password_hash(self, learner_id: UUID) -> str | None:
        """The current password hash, with the learner's row locked until the transaction
        ends: sign-in, a reset, a change and a new reset link take this lock, so none of them
        acts on a password another has just replaced."""
        return (
            await self._session.execute(
                select(Learner.password_hash).where(Learner.id == learner_id).with_for_update()
            )
        ).scalar_one_or_none()

    async def status(self, learner_id: UUID) -> str | None:
        return (
            await self._session.execute(select(Learner.status).where(Learner.id == learner_id))
        ).scalar_one_or_none()

    async def set_password_hash(self, learner_id: UUID, password_hash: str) -> None:
        await self._session.execute(
            update(Learner).where(Learner.id == learner_id).values(password_hash=password_hash)
        )

    async def profile(self, learner_id: UUID) -> Profile | None:
        row = (
            await self._session.execute(
                select(
                    Learner.id,
                    Learner.email,
                    Learner.l1,
                    Learner.birth_year,
                    Learner.tz,
                    Learner.daily_goal_min,
                    Learner.status,
                    Learner.created_at,
                    LearnerSettings.desired_retention,
                    LearnerSettings.rest_days,
                    LearnerSettings.leagues_opt_in,
                    LearnerSettings.perfectionist_mode,
                    LearnerSettings.data_collection_paused,
                    LearnerSettings.spelling_variant,
                    LearnerSettings.voice_consent,
                    LearnerSettings.training_opt_in,
                    LearnerSettings.a11y_no_audio,
                    LearnerSettings.a11y_no_vision,
                    Learner.display_name,
                    LearnerSettings.league_tier,
                    LearnerSettings.leagues_left_at,
                )
                .join(LearnerSettings, LearnerSettings.learner_id == Learner.id)
                .where(Learner.id == learner_id)
            )
        ).one_or_none()
        if row is None:
            return None
        return Profile(**row._asdict())
