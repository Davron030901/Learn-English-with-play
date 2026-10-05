"""The award pipeline (docs/16 E00, backend brief Phase 6).

Runs in the same transaction as review ingest, over the answers just accepted, in the order the
learner gave them:

* **The day** — answers, accuracy, time on task, the run of right answers, speaking and
  listening counts, words watered (answered while due), XP (``app.domain.xp``).
* **The daily goal** — met once time on task reaches the learner's own goal: +10 gems.
* **Node-tiers** — a tier counts when the server saw it passed in one session (docs/08 §4.3:
  ≥ 70 / 80 / 85 % right, ≤ 2 hints at tier 2, none at tier 3, tier 3 only 3 days after tier 2).
  A unit whose every lesson, story and speaking node reached tier 2 is complete: +30 gems, and
  its can-do statements are stamped into the English Passport.
* **Quests** — three daily and two weekly (``app.domain.quests``): +15 gems each, once.
* **The streak** — settled on the learner's local days (``app.domain.streaks``).

Every award is idempotent (gems by (reason, ref), progress rows by key), so a replayed batch
awards nothing twice. Nothing here can take anything away from the learner.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from typing import Any, Final
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.content.catalog import ITEM_BEARING_KINDS, ContentCatalog
from app.domain import quests as q
from app.domain.composer import TIER3_SPACING
from app.domain.grading import FAMILY
from app.domain.streaks import StreakState, can_repair, local_day, reset_message, settle
from app.domain.xp import ItemEffort, item_xp
from app.domain.xp import Outcome as XpOutcome
from app.ids import Uuid7Sequence
from app.models.gamification import (
    Badge,
    GemLedger,
    LearnerDay,
    NodeProgress,
    Streak,
    UnitProgress,
    XpEvent,
)
from app.models.review import ReviewAttempt
from app.repositories.learners import Profile
from app.services.reviews import Outcome

#: Seconds added per answer for reading the feedback, on top of the response time.
FEEDBACK_ALLOWANCE_MS: Final = 3_000
DAILY_GOAL_GEMS: Final = 10
UNIT_GEMS: Final = 30
CHECKPOINT_GEMS: Final = 60  # docs/10 §9: checkpoint passed
#: docs/08 §4.3 pass marks
TIER_PASS: Final[dict[int, float]] = {1: 0.70, 2: 0.80, 3: 0.85}
TIER_MAX_HINTS: Final[dict[int, int | None]] = {1: None, 2: 2, 3: 0}
#: share of a tier's items a session must answer for the tier to count
TIER_COVERAGE: Final = 0.6
LISTENING_TYPES: Final = frozenset(
    {
        "listen_gist_mcq",
        "listen_detail_gap",
        "listen_order_events",
        "dictation_word",
        "dictation_sentence",
        "minimal_pair_discrimination",
        "phoneme_id",
    }
)


# ------------------------------------------------------------------- views


@dataclass(slots=True)
class GoalView:
    goal_min: int
    minutes_today: float
    met: bool
    met_now: bool = False


@dataclass(slots=True)
class StreakView:
    current: int
    longest: int
    freezes: int
    today_counted: bool
    rest_days: list[int]
    paused_until: date | None
    can_repair: bool
    milestone_now: int | None = None
    #: the kind reset message, shown once (docs/10 §5)
    reset_message: str | None = None


@dataclass(slots=True)
class QuestView:
    id: str
    period: str
    metric: str
    title: dict[str, str]
    progress: int
    target: int
    completed: bool
    completed_now: bool = False
    gems: int = q.QUEST_GEMS


@dataclass(slots=True)
class BadgeView:
    id: str
    unit_id: str
    text: str
    awarded_at: datetime


@dataclass(slots=True)
class Awards:
    xp: int = 0
    gems: int = 0
    goal: GoalView | None = None
    streak: StreakView | None = None
    quests_completed: list[QuestView] = field(default_factory=list)
    nodes_completed: list[tuple[str, int]] = field(default_factory=list)
    units_completed: list[str] = field(default_factory=list)
    sections_completed: list[str] = field(default_factory=list)
    badges: list[BadgeView] = field(default_factory=list)
    best_run: int = 0


@dataclass(slots=True)
class Summary:
    as_of: datetime
    today: date
    xp_today: int
    xp_week: int
    xp_total: int
    gems: int
    goal: GoalView
    streak: StreakView
    daily: list[QuestView]
    weekly: list[QuestView]
    unseen_badges: list[BadgeView]


@dataclass(slots=True)
class _Day:
    answers: int = 0
    correct: int = 0
    active_ms: int = 0
    xp_centi: int = 0
    run_now: int = 0
    best_run: int = 0
    speaking: int = 0
    listening: int = 0
    reviewed_due: int = 0
    nodes_completed: int = 0
    goal_met_at: datetime | None = None
    exists: bool = False


def _xp_outcome(o: Outcome) -> XpOutcome:
    if o.timed_out:
        return XpOutcome.TIMEOUT
    return XpOutcome(o.verdict or "ungraded")


def _streak_state(row: Streak | None) -> StreakState:
    if row is None:
        return StreakState()
    return StreakState(
        current=row.current,
        longest=row.longest,
        last_counted=row.last_counted,
        settled_through=row.settled_through,
        freezes=row.freezes,
        freeze_clock=row.freeze_clock,
        paused_from=row.paused_from,
        paused_until=row.paused_until,
        broken_on=row.broken_on,
        broken_length=row.broken_length,
        repaired_month=row.repaired_month,
    )


def _streak_values(s: StreakState) -> dict[str, Any]:
    return {
        "current": s.current,
        "longest": s.longest,
        "last_counted": s.last_counted,
        "settled_through": s.settled_through,
        "freezes": s.freezes,
        "freeze_clock": s.freeze_clock,
        "paused_from": s.paused_from,
        "paused_until": s.paused_until,
        "broken_on": s.broken_on,
        "broken_length": s.broken_length,
        "repaired_month": s.repaired_month,
    }


class GamificationService:
    def __init__(self, session: AsyncSession, catalog: ContentCatalog, clock: Clock) -> None:
        self._session = session
        self._catalog = catalog
        self._clock = clock
        self._ids = Uuid7Sequence()

    # =============================================================== award pipeline

    async def apply(
        self, learner_id: UUID, profile: Profile, outcomes: Sequence[Outcome]
    ) -> Awards:
        awards = Awards()
        accepted = sorted(
            (
                o
                for o in outcomes
                if o.status == "accepted" and o.item is not None and o.answered_at
            ),
            key=lambda o: o.answered_at or self._clock.now(),
        )
        now = self._clock.now()
        if not accepted:
            awards.streak = await self._settle_streak(learner_id, profile, now)
            awards.goal = await self._goal(learner_id, profile, local_day(now, profile.tz))
            return awards

        days = await self._load_days(
            learner_id, {local_day(o.answered_at, profile.tz) for o in accepted if o.answered_at}
        )
        goal_ms = profile.daily_goal_min * 60_000
        xp_centi_total = 0
        for o in accepted:
            if o.item is None or o.answered_at is None:  # filtered above; for the type checker
                continue
            day = local_day(o.answered_at, profile.tz)
            d = days[day]
            d.answers += 1
            correct = o.verdict == "correct"
            d.correct += int(correct)
            d.active_ms += o.rt_ms + FEEDBACK_ALLOWANCE_MS
            if correct and o.hints_used == 0:
                d.run_now += 1
                d.best_run = max(d.best_run, d.run_now)
            elif o.verdict == "incorrect":
                d.run_now = 0
            family = FAMILY.get(o.item.type_id)
            d.speaking += int(family == "speak")
            d.listening += int(o.item.type_id in LISTENING_TYPES)
            d.reviewed_due += int(o.was_due)
            xp = item_xp(ItemEffort(o.item.type_id, _xp_outcome(o), o.p_correct, o.regrind))
            centi = round(xp * 100)
            d.xp_centi += centi
            xp_centi_total += centi
            self._session.add(
                XpEvent(
                    learner_id=learner_id,
                    id=self._ids.next(),
                    ts=o.answered_at,
                    day=day,
                    source="answer",
                    xp_centi=centi,
                    attempt_id=o.attempt_id,
                    session_id=o.session_id,
                    regrind=o.regrind,
                )
            )
            if d.goal_met_at is None and d.active_ms >= goal_ms:
                d.goal_met_at = o.answered_at
                if await self._award_gems(
                    learner_id, DAILY_GOAL_GEMS, "daily_goal", day.isoformat(), o.answered_at
                ):
                    awards.gems += DAILY_GOAL_GEMS
                    if day == local_day(now, profile.tz):
                        awards.goal = GoalView(
                            profile.daily_goal_min, d.active_ms / 60_000, True, True
                        )
            awards.best_run = max(awards.best_run, d.best_run)
        awards.xp = math.floor(xp_centi_total / 100 + 0.5)

        await self._progress_nodes(learner_id, accepted, days, profile, awards)
        await self._save_days(learner_id, days)
        for day in sorted(days):
            await self._quests(learner_id, profile, day, awards, now)
        awards.streak = await self._settle_streak(learner_id, profile, now)
        if awards.goal is None:
            awards.goal = await self._goal(learner_id, profile, local_day(now, profile.tz))
        return awards

    async def credit_activity(
        self,
        learner_id: UUID,
        profile: Profile,
        *,
        at: datetime,
        active_ms: int,
        xp: int,
        source: str,
        session_id: UUID | None,
    ) -> Awards:
        """Practice outside the item stream (an AI conversation turn) counts like answers do:
        time on task toward the daily goal, XP, quests and the streak (docs/16 E21)."""
        awards = Awards()
        now = self._clock.now()
        day = local_day(at, profile.tz)
        days = await self._load_days(learner_id, [day])
        d = days[day]
        d.active_ms += max(0, active_ms)
        centi = max(0, xp) * 100
        d.xp_centi += centi
        self._session.add(
            XpEvent(
                learner_id=learner_id,
                id=self._ids.next(),
                ts=at,
                day=day,
                source=source,
                xp_centi=centi,
                attempt_id=None,
                session_id=session_id,
                regrind=False,
            )
        )
        awards.xp = max(0, xp)
        if d.goal_met_at is None and d.active_ms >= profile.daily_goal_min * 60_000:
            d.goal_met_at = at
            if await self._award_gems(
                learner_id, DAILY_GOAL_GEMS, "daily_goal", day.isoformat(), at
            ):
                awards.gems += DAILY_GOAL_GEMS
                if day == local_day(now, profile.tz):
                    awards.goal = GoalView(profile.daily_goal_min, d.active_ms / 60_000, True, True)
        await self._save_days(learner_id, days)
        await self._quests(learner_id, profile, day, awards, now)
        awards.streak = await self._settle_streak(learner_id, profile, now)
        if awards.goal is None:
            awards.goal = await self._goal(learner_id, profile, local_day(now, profile.tz))
        return awards

    # --------------------------------------------------------------- days

    async def _load_days(self, learner_id: UUID, wanted: Iterable[date]) -> dict[date, _Day]:
        wanted = sorted(set(wanted))
        rows = await self._session.execute(
            select(*LearnerDay.__table__.c).where(
                LearnerDay.learner_id == learner_id, LearnerDay.day.in_(wanted)
            )
        )
        out = {d: _Day() for d in wanted}
        for r in rows:
            out[r.day] = _Day(
                answers=r.answers,
                correct=r.correct,
                active_ms=r.active_ms,
                xp_centi=r.xp_centi,
                run_now=r.run_now,
                best_run=r.best_run,
                speaking=r.speaking,
                listening=r.listening,
                reviewed_due=r.reviewed_due,
                nodes_completed=r.nodes_completed,
                goal_met_at=r.goal_met_at,
                exists=True,
            )
        return out

    async def _save_days(self, learner_id: UUID, days: dict[date, _Day]) -> None:
        for day, d in days.items():
            values = {
                "learner_id": learner_id,
                "day": day,
                "answers": d.answers,
                "correct": d.correct,
                "active_ms": d.active_ms,
                "xp_centi": d.xp_centi,
                "run_now": min(d.run_now, 32_000),
                "best_run": min(d.best_run, 32_000),
                "speaking": d.speaking,
                "listening": d.listening,
                "reviewed_due": d.reviewed_due,
                "nodes_completed": d.nodes_completed,
                "goal_met_at": d.goal_met_at,
            }
            stmt = insert(LearnerDay).values(values)
            await self._session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[LearnerDay.learner_id, LearnerDay.day],
                    set_={k: stmt.excluded[k] for k in values if k not in ("learner_id", "day")},
                )
            )

    async def _award_gems(
        self, learner_id: UUID, amount: int, reason: str, ref: str, ts: datetime
    ) -> bool:
        """True when this award is new (an award is made once per (reason, ref), ever)."""
        result = await self._session.execute(
            insert(GemLedger)
            .values(
                learner_id=learner_id,
                id=self._ids.next(),
                ts=ts,
                amount=amount,
                reason=reason,
                ref=ref,
            )
            .on_conflict_do_nothing(constraint="uq_gem_ledger_learner_id_reason_ref")
            .returning(GemLedger.id)
        )
        return result.first() is not None

    # --------------------------------------------------------------- node-tiers and units

    async def _progress_nodes(
        self,
        learner_id: UUID,
        accepted: Sequence[Outcome],
        days: dict[date, _Day],
        profile: Profile,
        awards: Awards,
    ) -> None:
        touched: dict[tuple[UUID, str, int], datetime] = {}
        for o in accepted:
            if o.session_id is None or o.item is None or o.answered_at is None:
                continue
            key = (o.session_id, o.item.node_id, o.item.tier)
            touched[key] = max(touched.get(key, o.answered_at), o.answered_at)
        if not touched:
            return
        done = await self._completed_tiers(learner_id)
        units_to_check: set[str] = set()
        for (session_id, node_id, tier), at in sorted(touched.items(), key=lambda kv: kv[1]):
            if (node_id, tier) in done:
                continue
            node = self._catalog.nodes.get(node_id)
            if node is None or node.kind not in ITEM_BEARING_KINDS:
                continue
            tier_items = node.tiers.get(tier, ())
            if not tier_items:
                continue
            if tier == 3:
                t2 = done.get((node_id, 2))
                if t2 is None or at - t2 < TIER3_SPACING:
                    continue
            passed, accuracy = await self._tier_passed(learner_id, session_id, tier, tier_items)
            if not passed:
                continue
            self._session.add(
                NodeProgress(
                    learner_id=learner_id,
                    node_id=node_id,
                    tier=tier,
                    completed_at=at,
                    accuracy=accuracy,
                    session_id=session_id,
                )
            )
            done[(node_id, tier)] = at
            awards.nodes_completed.append((node_id, tier))
            days[local_day(at, profile.tz)].nodes_completed += 1
            units_to_check.add(node.unit_id)
        await self._session.flush()
        for unit_id in sorted(units_to_check):
            await self._complete_unit(learner_id, unit_id, done, awards)

    async def _completed_tiers(self, learner_id: UUID) -> dict[tuple[str, int], datetime]:
        rows = await self._session.execute(
            select(NodeProgress.node_id, NodeProgress.tier, NodeProgress.completed_at).where(
                NodeProgress.learner_id == learner_id
            )
        )
        return {(r.node_id, r.tier): r.completed_at for r in rows}

    async def _tier_passed(
        self, learner_id: UUID, session_id: UUID, tier: int, tier_items: Sequence[str]
    ) -> tuple[bool, float | None]:
        rows = await self._session.execute(
            select(ReviewAttempt.item_id, ReviewAttempt.verdict, ReviewAttempt.hints_used).where(
                ReviewAttempt.learner_id == learner_id,
                ReviewAttempt.session_id == session_id,
                ReviewAttempt.item_id.in_(list(tier_items)),
            )
        )
        attempts = list(rows)
        answered = {r.item_id for r in attempts}
        if len(answered) < math.ceil(TIER_COVERAGE * len(tier_items)):
            return False, None
        graded = [r for r in attempts if r.verdict != "ungraded"]
        accuracy = sum(r.verdict == "correct" for r in graded) / len(graded) if graded else None
        hints = sum(r.hints_used for r in attempts)
        max_hints = TIER_MAX_HINTS[tier]
        if max_hints is not None and hints > max_hints:
            return False, accuracy
        if accuracy is not None and accuracy < TIER_PASS[tier]:
            return False, accuracy
        return True, accuracy

    def _required_tier(self, node_id: str) -> int:
        node = self._catalog.nodes[node_id]
        return min(2, max(node.tiers)) if node.tiers else 0

    async def _complete_unit(
        self, learner_id: UUID, unit_id: str, done: dict[tuple[str, int], datetime], awards: Awards
    ) -> None:
        unit = self._catalog.units[unit_id]
        required = [
            n
            for n in unit.node_ids
            if self._catalog.nodes[n].kind in ITEM_BEARING_KINDS and self._catalog.nodes[n].tiers
        ]
        if not all(any((n, t) in done for t in range(self._required_tier(n), 4)) for n in required):
            return
        at = max(done[(n, t)] for n in required for t in range(1, 4) if (n, t) in done)
        result = await self._session.execute(
            insert(UnitProgress)
            .values(learner_id=learner_id, unit_id=unit_id, completed_at=at)
            .on_conflict_do_nothing()
            .returning(UnitProgress.unit_id)
        )
        if result.first() is None:
            return
        awards.units_completed.append(unit_id)
        if await self._award_gems(learner_id, UNIT_GEMS, "unit_complete", unit_id, at):
            awards.gems += UNIT_GEMS
        for i, text in enumerate(unit.can_do, start=1):
            badge_id = f"{unit_id}:{i}"
            await self._session.execute(
                insert(Badge)
                .values(learner_id=learner_id, badge_id=badge_id, unit_id=unit_id, awarded_at=at)
                .on_conflict_do_nothing()
            )
            awards.badges.append(BadgeView(badge_id, unit_id, text, at))
        section = self._catalog.units[unit_id].section_id
        section_units = next(s.unit_ids for s in self._catalog.sections if s.id == section)
        completed = await self._session.execute(
            select(func.count())
            .select_from(UnitProgress)
            .where(UnitProgress.learner_id == learner_id, UnitProgress.unit_id.in_(section_units))
        )
        if int(completed.scalar_one()) == len(section_units):
            awards.sections_completed.append(section)

    async def credit_test_out(self, learner_id: UUID, unit_id: str, at: datetime) -> Awards:
        """A passed unit test-out (docs/10 §4): every node not yet at its required tier is
        credited there, marked ``tested_out``; the unit completes; +60 gems once per unit."""
        awards = Awards()
        done = await self._completed_tiers(learner_id)
        unit = self._catalog.units[unit_id]
        for node_id in unit.node_ids:
            node = self._catalog.nodes[node_id]
            if node.kind not in ITEM_BEARING_KINDS or not node.tiers:
                continue
            required = self._required_tier(node_id)
            if any((node_id, t) in done for t in range(required, 4)):
                continue
            self._session.add(
                NodeProgress(
                    learner_id=learner_id,
                    node_id=node_id,
                    tier=required,
                    completed_at=at,
                    accuracy=None,
                    session_id=None,
                    tested_out=True,
                )
            )
            done[(node_id, required)] = at
            awards.nodes_completed.append((node_id, required))
        await self._session.flush()
        await self._complete_unit(learner_id, unit_id, done, awards)
        if await self._award_gems(learner_id, CHECKPOINT_GEMS, "checkpoint", unit_id, at):
            awards.gems += CHECKPOINT_GEMS
        return awards

    # --------------------------------------------------------------- quests

    async def _quest_views(
        self, learner_id: UUID, profile: Profile, day: date
    ) -> tuple[list[QuestView], list[QuestView]]:
        week = q.week_start(day)
        rows = await self._session.execute(
            select(*LearnerDay.__table__.c).where(
                LearnerDay.learner_id == learner_id,
                LearnerDay.day >= week,
                LearnerDay.day < week + timedelta(days=7),
            )
        )
        week_days = {r.day: r for r in rows}
        today = week_days.get(day)
        metrics_today = {
            "answers": today.answers if today else 0,
            "correct": today.correct if today else 0,
            "best_run": today.best_run if today else 0,
            "speaking": today.speaking if today else 0,
            "listening": today.listening if today else 0,
            "reviewed_due": today.reviewed_due if today else 0,
            "xp": (today.xp_centi // 100) if today else 0,
        }
        metrics_week = {
            "xp": sum(r.xp_centi for r in week_days.values()) // 100,
            "active_days": sum(1 for r in week_days.values() if r.answers > 0),
            "nodes": sum(r.nodes_completed for r in week_days.values()),
        }
        awarded = await self._session.execute(
            select(GemLedger.ref).where(
                GemLedger.learner_id == learner_id,
                GemLedger.reason == "quest",
                GemLedger.ref.in_(
                    [f"day:{day.isoformat()}:{m}" for m in q.DAILY_TEMPLATES]
                    + [f"week:{week.isoformat()}:{m}" for m in q.WEEKLY_TEMPLATES]
                ),
            )
        )
        done_refs = {r.ref for r in awarded}

        def view(quest: q.Quest, progress: int, prefix: str) -> QuestView:
            ref = f"{prefix}:{quest.period_start.isoformat()}:{quest.metric}"
            return QuestView(
                id=ref,
                period=quest.period,
                metric=quest.metric,
                title=quest.title,
                progress=min(progress, quest.target),
                target=quest.target,
                completed=ref in done_refs,
            )

        lid = str(learner_id)
        daily = [
            view(x, metrics_today[x.metric], "day")
            for x in q.daily_quests(lid, day, profile.daily_goal_min)
        ]
        weekly = [
            view(x, metrics_week[x.metric], "week")
            for x in q.weekly_quests(lid, day, profile.daily_goal_min)
        ]
        return daily, weekly

    async def _quests(
        self, learner_id: UUID, profile: Profile, day: date, awards: Awards, now: datetime
    ) -> None:
        daily, weekly = await self._quest_views(learner_id, profile, day)
        for v in [*daily, *weekly]:
            if v.completed or v.progress < v.target:
                continue
            if await self._award_gems(learner_id, q.QUEST_GEMS, "quest", v.id, now):
                awards.gems += q.QUEST_GEMS
                awards.quests_completed.append(replace(v, completed=True, completed_now=True))

    # --------------------------------------------------------------- goal and streak

    async def _goal(self, learner_id: UUID, profile: Profile, today: date) -> GoalView:
        row = (
            await self._session.execute(
                select(LearnerDay.active_ms, LearnerDay.goal_met_at).where(
                    LearnerDay.learner_id == learner_id, LearnerDay.day == today
                )
            )
        ).one_or_none()
        minutes = (row.active_ms / 60_000) if row else 0.0
        return GoalView(profile.daily_goal_min, round(minutes, 1), bool(row and row.goal_met_at))

    async def _settle_streak(self, learner_id: UUID, profile: Profile, now: datetime) -> StreakView:
        today = local_day(now, profile.tz)
        row = (
            await self._session.execute(
                select(Streak)
                .where(Streak.learner_id == learner_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        state = _streak_state(row)
        start = state.settled_through or today - timedelta(days=60)
        counted_rows = await self._session.execute(
            select(LearnerDay.day).where(
                LearnerDay.learner_id == learner_id,
                LearnerDay.day > start - timedelta(days=1),
                LearnerDay.day <= today,
                # a day counts when the learner practised: answered, or talked (docs/16 E21)
                or_(LearnerDay.answers > 0, LearnerDay.active_ms > 0),
            )
        )
        counted = frozenset(r.day for r in counted_rows)
        through = today if today in counted else today - timedelta(days=1)
        result = settle(
            state, through=through, counted_days=counted, rest_weekdays=frozenset(profile.rest_days)
        )
        values = _streak_values(result.state)
        unseen = row.unseen_reset_from if row else None
        if result.reset_from:
            unseen = result.reset_from
        values["unseen_reset_from"] = unseen
        stmt = insert(Streak).values(learner_id=learner_id, **values)
        await self._session.execute(
            stmt.on_conflict_do_update(index_elements=[Streak.learner_id], set_=values)
        )
        return StreakView(
            current=result.state.current,
            longest=result.state.longest,
            freezes=result.state.freezes,
            today_counted=today in counted,
            rest_days=list(profile.rest_days),
            paused_until=(
                result.state.paused_until
                if result.state.paused_until and result.state.paused_until >= today
                else None
            ),
            can_repair=can_repair(result.state, today),
            milestone_now=max(result.milestones) if result.milestones else None,
            reset_message=reset_message(unseen) if unseen else None,
        )

    # =============================================================== reads

    async def summary(self, learner_id: UUID, profile: Profile) -> Summary:
        now = self._clock.now()
        today = local_day(now, profile.tz)
        streak = await self._settle_streak(learner_id, profile, now)
        goal = await self._goal(learner_id, profile, today)
        daily, weekly = await self._quest_views(learner_id, profile, today)
        totals = await self._session.execute(
            select(
                func.coalesce(func.sum(LearnerDay.xp_centi), 0),
                func.coalesce(
                    func.sum(LearnerDay.xp_centi).filter(LearnerDay.day >= q.week_start(today)), 0
                ),
                func.coalesce(func.sum(LearnerDay.xp_centi).filter(LearnerDay.day == today), 0),
            ).where(LearnerDay.learner_id == learner_id)
        )
        total, week, day = totals.one()
        gems = await self._session.execute(
            select(func.coalesce(func.sum(GemLedger.amount), 0)).where(
                GemLedger.learner_id == learner_id
            )
        )
        unseen = await self._session.execute(
            select(Badge)
            .where(Badge.learner_id == learner_id, Badge.seen.is_(False))
            .order_by(Badge.awarded_at)
        )
        badges = [
            BadgeView(b.badge_id, b.unit_id, self._badge_text(b.badge_id), b.awarded_at)
            for (b,) in unseen
        ]
        return Summary(
            as_of=now,
            today=today,
            xp_today=int(day) // 100,
            xp_week=int(week) // 100,
            xp_total=int(total) // 100,
            gems=int(gems.scalar_one()),
            goal=goal,
            streak=streak,
            daily=daily,
            weekly=weekly,
            unseen_badges=badges,
        )

    def _badge_text(self, badge_id: str) -> str:
        unit_id, _, n = badge_id.partition(":")
        unit = self._catalog.units.get(unit_id)
        if unit is None or not n.isdigit() or not 0 < int(n) <= len(unit.can_do):
            return ""
        return unit.can_do[int(n) - 1]

    async def acknowledge_reset(self, learner_id: UUID) -> None:
        row = await self._session.get(Streak, learner_id, with_for_update=True)
        if row is not None:
            row.unseen_reset_from = None

    async def mark_badges_seen(self, learner_id: UUID, badge_ids: Sequence[str]) -> None:
        rows = await self._session.execute(
            select(Badge).where(Badge.learner_id == learner_id, Badge.badge_id.in_(list(badge_ids)))
        )
        for (b,) in rows:
            b.seen = True


def group_by_unit(badges: Iterable[BadgeView]) -> dict[str, list[BadgeView]]:
    out: dict[str, list[BadgeView]] = defaultdict(list)
    for b in badges:
        out[b.unit_id].append(b)
    return out
