"""Opt-in weekly leagues (docs/16 E23) — joining, the live table, settlement and results.

The rules are in ``app.domain.leagues``; this module only reads and writes. Three things keep it
honest and cheap:

* A learner joins a group of the week only when they earn XP that counts in it, so a group
  holds people who are learning this week, never idle names.
* A week is settled once, under its league's row lock — by the Sunday job, or by the first
  member who asks after it ended, whichever comes first. Settlement writes the league's rows
  only; each learner's own tier follows on their own next request.
* Nothing is sent about rank or demotion: the result waits in the app for the next open.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.domain import leagues as lg
from app.domain.age_policy import is_minor
from app.domain.streaks import local_day
from app.ids import Uuid7Sequence
from app.models.gamification import League, LeagueMember, Streak, XpEvent
from app.models.learner import Learner, LearnerSettings
from app.repositories.learners import Profile


@dataclass(frozen=True, slots=True)
class Row:
    rank: int
    display_name: str | None
    xp: int
    you: bool
    zone: str | None


@dataclass(frozen=True, slots=True)
class Table:
    id: UUID
    tier: int
    rows: list[Row]


@dataclass(frozen=True, slots=True)
class Result:
    week_starts_at: datetime
    week_ends_at: datetime
    tier_before: int
    tier_after: int
    rank: int
    moved: int
    xp: int
    members: int


@dataclass(frozen=True, slots=True)
class Status:
    opted_in: bool
    eligible: bool
    tier: int
    week: lg.Week
    table: Table | None
    result: Result | None


def eligible(profile: Profile, now: datetime) -> bool:
    """docs/10 §8.8: no league for a learner who might be under 18."""
    return not is_minor(profile.birth_year, local_day(now, profile.tz))


class LeagueService:
    def __init__(self, session: AsyncSession, clock: Clock) -> None:
        self._session = session
        self._clock = clock
        self._ids = Uuid7Sequence()

    # =============================================================== joining

    async def on_xp(self, learner_id: UUID, profile: Profile, *, paused: bool) -> None:
        """The learner just earned XP that counts this week: join a group if they have none.

        Not while the streak is paused (a paused week has no movement), and never for a learner
        who did not opt in or might be a minor."""
        now = self._clock.now()
        if not profile.leagues_opt_in or paused or not eligible(profile, now):
            return
        week = lg.week_of(now)
        already = await self._session.execute(
            select(LeagueMember.league_id).where(
                LeagueMember.learner_id == learner_id,
                LeagueMember.week_starts_at == week.starts_at,
            )
        )
        if already.first() is not None:
            return
        tier = await self.catch_up(learner_id)
        last_week = (await self._week_xp([learner_id], lg.previous(week))).get(learner_id, 0)
        last_xp = lg.xp(last_week)
        # every open group of the tier, locked in one order, so two learners joining at once
        # cannot both take the thirtieth place
        candidates = (
            (
                await self._session.execute(
                    select(League.id, League.seed_xp)
                    .where(
                        League.week_starts_at == week.starts_at,
                        League.tier == tier,
                        League.settled_at.is_(None),
                    )
                    .order_by(League.id)
                    .with_for_update()
                )
            )
            .tuples()
            .all()
        )
        counts = await self._member_counts([c[0] for c in candidates])
        chosen = lg.choose_group(
            [lg.Group(lid, seed, counts.get(lid, 0)) for lid, seed in candidates], last_xp
        )
        if chosen is None:
            league_id = self._ids.next()
            self._session.add(
                League(
                    id=league_id,
                    week_starts_at=week.starts_at,
                    tier=tier,
                    seed_xp=last_xp,
                    created_at=now,
                )
            )
            await self._session.flush()
        else:
            league_id = chosen.id  # type: ignore[assignment]
        await self._session.execute(
            insert(LeagueMember)
            .values(
                league_id=league_id,
                learner_id=learner_id,
                week_starts_at=week.starts_at,
                joined_at=now,
            )
            .on_conflict_do_nothing(constraint="uq_league_members_learner_id_week_starts_at")
        )

    async def _member_counts(self, league_ids: Sequence[UUID]) -> dict[UUID, int]:
        if not league_ids:
            return {}
        rows = await self._session.execute(
            select(LeagueMember.league_id, func.count())
            .where(LeagueMember.league_id.in_(list(league_ids)))
            .group_by(LeagueMember.league_id)
        )
        return {lid: int(n) for lid, n in rows.tuples()}

    # =============================================================== settlement

    async def catch_up(self, learner_id: UUID) -> int:
        """Settle the learner's ended weeks and apply their results; the learner's tier now."""
        now = self._clock.now()
        ended = await self._session.execute(
            select(League.id)
            .join(LeagueMember, LeagueMember.league_id == League.id)
            .where(
                LeagueMember.learner_id == learner_id,
                League.settled_at.is_(None),
                League.week_starts_at <= now - lg.WEEK,
            )
            .order_by(League.week_starts_at)
        )
        for (league_id,) in ended.tuples().all():
            await self.settle(league_id)
        pending = (
            (
                await self._session.execute(
                    select(LeagueMember.tier_after)
                    .where(
                        LeagueMember.learner_id == learner_id,
                        LeagueMember.tier_after.is_not(None),
                        LeagueMember.tier_applied.is_(False),
                    )
                    .order_by(LeagueMember.week_starts_at)
                )
            )
            .scalars()
            .all()
        )
        settings = await self._session.get(
            LearnerSettings, learner_id, with_for_update=bool(pending)
        )
        if settings is None:
            return 1
        if pending and pending[-1] is not None:
            settings.league_tier = pending[-1]
            await self._session.execute(
                update(LeagueMember)
                .where(
                    LeagueMember.learner_id == learner_id,
                    LeagueMember.tier_after.is_not(None),
                    LeagueMember.tier_applied.is_(False),
                )
                .values(tier_applied=True)
            )
        return settings.league_tier

    async def settle(self, league_id: UUID) -> bool:
        """Rank one ended week and record each member's move. False when there was nothing to do
        (the week has not ended, or someone settled it first)."""
        now = self._clock.now()
        league = (
            await self._session.execute(
                select(League)
                .where(League.id == league_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if league is None or league.settled_at is not None:
            return False
        week = lg.Week(league.week_starts_at, league.week_starts_at + lg.WEEK)
        if week.ends_at > now:
            return False
        members = (
            (
                await self._session.execute(
                    select(LeagueMember.learner_id, LeagueMember.joined_at).where(
                        LeagueMember.league_id == league_id
                    )
                )
            )
            .tuples()
            .all()
        )
        ids = [m[0] for m in members]
        xp = await self._week_xp(ids, week)
        paused = await self._paused_on(ids, week.last_day)
        for s in lg.standings(
            league.tier,
            [lg.Entry(lid, xp.get(lid, 0), joined, lid in paused) for lid, joined in members],
        ):
            await self._session.execute(
                update(LeagueMember)
                .where(LeagueMember.league_id == league_id, LeagueMember.learner_id == s.learner_id)
                .values(
                    final_xp_centi=s.xp_centi,
                    final_rank=s.rank,
                    moved=s.moved,
                    tier_after=lg.tier_after(league.tier, s.moved),
                )
            )
        league.settled_at = now
        await self._session.flush()
        return True

    async def settle_ended(self) -> int:
        """Every ended week not yet settled — the Sunday job. Idempotent."""
        now = self._clock.now()
        ids = (
            (
                await self._session.execute(
                    select(League.id)
                    .where(League.settled_at.is_(None), League.week_starts_at <= now - lg.WEEK)
                    .order_by(League.week_starts_at, League.id)
                )
            )
            .scalars()
            .all()
        )
        settled = 0
        for league_id in ids:
            settled += int(await self.settle(league_id))
        return settled

    async def _week_xp(self, learner_ids: Sequence[UUID], week: lg.Week) -> dict[UUID, int]:
        """Weekly XP in hundredths: only XP that counts (no re-grind), earned within the week."""
        if not learner_ids:
            return {}
        rows = await self._session.execute(
            select(XpEvent.learner_id, func.sum(XpEvent.xp_centi))
            .where(
                XpEvent.learner_id.in_(list(learner_ids)),
                XpEvent.regrind.is_(False),
                XpEvent.ts >= week.starts_at,
                XpEvent.ts < week.ends_at,
            )
            .group_by(XpEvent.learner_id)
        )
        return {lid: int(total) for lid, total in rows.tuples()}

    async def _paused_on(self, learner_ids: Sequence[UUID], day: object) -> set[UUID]:
        if not learner_ids:
            return set()
        rows = await self._session.execute(
            select(Streak.learner_id).where(
                Streak.learner_id.in_(list(learner_ids)),
                Streak.paused_from <= day,
                Streak.paused_until >= day,
            )
        )
        return set(rows.scalars().all())

    # =============================================================== reads

    async def status(self, learner_id: UUID, profile: Profile) -> Status:
        now = self._clock.now()
        tier = await self.catch_up(learner_id)
        week = lg.week_of(now)
        mine = (
            await self._session.execute(
                select(League.id, League.tier)
                .join(LeagueMember, LeagueMember.league_id == League.id)
                .where(
                    LeagueMember.learner_id == learner_id,
                    LeagueMember.week_starts_at == week.starts_at,
                )
            )
        ).one_or_none()
        table = await self._table(mine.id, mine.tier, week, learner_id) if mine else None
        return Status(
            opted_in=profile.leagues_opt_in,
            eligible=eligible(profile, now),
            tier=tier,
            week=week,
            table=table,
            result=await self._unseen_result(learner_id),
        )

    async def _table(self, league_id: UUID, tier: int, week: lg.Week, me: UUID) -> Table:
        members = (
            (
                await self._session.execute(
                    select(LeagueMember.learner_id, LeagueMember.joined_at, Learner.display_name)
                    .join(Learner, Learner.id == LeagueMember.learner_id)
                    .where(LeagueMember.league_id == league_id)
                )
            )
            .tuples()
            .all()
        )
        names = {lid: name for lid, _, name in members}
        xp = await self._week_xp(list(names), week)
        rows = [
            Row(
                rank=s.rank,
                display_name=names[s.learner_id],  # type: ignore[index]
                xp=lg.xp(s.xp_centi),
                you=s.learner_id == me,
                zone=s.zone,
            )
            for s in lg.standings(
                tier, [lg.Entry(lid, xp.get(lid, 0), joined) for lid, joined, _ in members]
            )
        ]
        return Table(league_id, tier, rows)

    async def _unseen_result(self, learner_id: UUID) -> Result | None:
        row = (
            await self._session.execute(
                select(LeagueMember, League.tier)
                .join(League, League.id == LeagueMember.league_id)
                .where(
                    LeagueMember.learner_id == learner_id,
                    LeagueMember.final_rank.is_not(None),
                    LeagueMember.result_seen.is_(False),
                )
                .order_by(LeagueMember.week_starts_at.desc())
                .limit(1)
            )
        ).one_or_none()
        if row is None:
            return None
        member, tier = row
        size = (await self._member_counts([member.league_id])).get(member.league_id, 0)
        return _result(member, tier, size)

    async def history(
        self, learner_id: UUID, before: datetime | None, limit: int
    ) -> tuple[list[Result], datetime | None]:
        """Settled weeks, newest first; the cursor is the oldest week returned."""
        sizes = (
            select(LeagueMember.league_id, func.count().label("n"))
            .group_by(LeagueMember.league_id)
            .subquery()
        )
        conditions = [LeagueMember.learner_id == learner_id, LeagueMember.final_rank.is_not(None)]
        if before is not None:
            conditions.append(LeagueMember.week_starts_at < before)
        rows = (
            await self._session.execute(
                select(LeagueMember, League.tier, sizes.c.n)
                .join(League, League.id == LeagueMember.league_id)
                .join(sizes, sizes.c.league_id == LeagueMember.league_id)
                .where(and_(*conditions))
                .order_by(LeagueMember.week_starts_at.desc())
                .limit(limit + 1)
            )
        ).all()
        page = [_result(m, tier, int(n)) for m, tier, n in rows[:limit]]
        return page, (page[-1].week_starts_at if len(rows) > limit else None)

    # =============================================================== the learner's choices

    async def mark_result_seen(self, learner_id: UUID) -> None:
        await self._session.execute(
            update(LeagueMember)
            .where(
                LeagueMember.learner_id == learner_id,
                LeagueMember.final_rank.is_not(None),
                LeagueMember.result_seen.is_(False),
            )
            .values(result_seen=True)
        )

    async def leave(self, learner_id: UUID) -> None:
        """Leaving takes the learner out of this week's table at once; a settled week stays."""
        week = lg.week_of(self._clock.now())
        await self._session.execute(
            delete(LeagueMember).where(
                LeagueMember.learner_id == learner_id,
                LeagueMember.week_starts_at == week.starts_at,
                LeagueMember.final_rank.is_(None),
            )
        )


def _result(member: LeagueMember, tier: int, size: int) -> Result:
    if (
        member.final_rank is None
        or member.moved is None
        or member.tier_after is None
        or member.final_xp_centi is None
    ):
        raise ValueError("a week that is not settled has no result")
    return Result(
        week_starts_at=member.week_starts_at,
        week_ends_at=member.week_starts_at + lg.WEEK,
        tier_before=tier,
        tier_after=member.tier_after,
        rank=member.final_rank,
        moved=member.moved,
        xp=lg.xp(member.final_xp_centi),
        members=size,
    )
