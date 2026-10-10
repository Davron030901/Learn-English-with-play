"""The motivation layer: summary, streak care, badges, settings (docs/10, docs/16 E00–E03, E10–E12).

Nothing here can cost the learner anything they learned, and nothing can be bought.
"""

from __future__ import annotations

from fastapi import APIRouter, Response

from app.api.v1.leagues import DisplayNameRequired, LeaguesNotForMinors
from app.deps import ContainerDep, CurrentPrincipal, DbSession
from app.domain import leagues as lg
from app.domain import streaks as st
from app.domain.age_policy import is_minor
from app.domain.display_names import InvalidDisplayName, normalise_display_name
from app.domain.scheduling import reschedule
from app.errors import FieldError, InvalidToken, StreakRuleRefused, ValidationFailed
from app.models.gamification import LearnerDay, Streak
from app.models.learner import Learner, LearnerSettings
from app.repositories.learners import LearnerRepository, Profile
from app.repositories.reviews import ReviewRepository
from app.schemas.gamification import (
    AwardsOut,
    BadgeOut,
    BadgesSeenRequest,
    GamificationSummary,
    Goal,
    NodeTier,
    PauseRequest,
    QuestOut,
    SettingsPatch,
    StreakOut,
)
from app.schemas.problem import problem_responses
from app.services.gamification import (
    Awards,
    BadgeView,
    GamificationService,
    GoalView,
    QuestView,
    StreakView,
)
from app.services.leagues import LeagueService

router = APIRouter(tags=["gamification"])


# ------------------------------------------------------------------- presenters (also used by sync)


def goal_out(g: GoalView) -> Goal:
    return Goal(goal_min=g.goal_min, minutes_today=g.minutes_today, met=g.met, met_now=g.met_now)


def streak_out(s: StreakView) -> StreakOut:
    return StreakOut(
        current=s.current,
        longest=s.longest,
        freezes=s.freezes,
        today_counted=s.today_counted,
        rest_days=s.rest_days,
        paused_until=s.paused_until,
        can_repair=s.can_repair,
        milestone_now=s.milestone_now,
        reset_message=s.reset_message,
    )


def quest_out(q: QuestView) -> QuestOut:
    return QuestOut(
        id=q.id,
        period=q.period,  # type: ignore[arg-type]
        metric=q.metric,
        title=q.title,
        progress=q.progress,
        target=q.target,
        completed=q.completed,
        completed_now=q.completed_now,
        gems=q.gems,
    )


def badge_out(b: BadgeView) -> BadgeOut:
    return BadgeOut(id=b.id, unit_id=b.unit_id, text=b.text, awarded_at=b.awarded_at)


def awards_out(a: Awards) -> AwardsOut:
    return AwardsOut(
        xp=a.xp,
        gems=a.gems,
        goal=goal_out(a.goal) if a.goal else None,
        streak=streak_out(a.streak) if a.streak else None,
        quests_completed=[quest_out(q) for q in a.quests_completed],
        nodes_completed=[NodeTier(node_id=n, tier=t) for n, t in a.nodes_completed],
        units_completed=a.units_completed,
        sections_completed=a.sections_completed,
        badges=[badge_out(b) for b in a.badges],
        best_run=a.best_run,
    )


async def _profile(principal: CurrentPrincipal, session: DbSession) -> Profile:
    profile = await LearnerRepository(session).profile(principal.learner_id)
    if profile is None:
        raise InvalidToken("This account no longer exists.")
    return profile


async def _summary(
    principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> GamificationSummary:
    profile = await _profile(principal, session)
    s = await GamificationService(session, container.content, container.clock).summary(
        principal.learner_id, profile
    )
    return GamificationSummary(
        as_of=s.as_of,
        today=s.today,
        xp_today=s.xp_today,
        xp_week=s.xp_week,
        xp_total=s.xp_total,
        gems=s.gems,
        goal=goal_out(s.goal),
        streak=streak_out(s.streak),
        daily_quests=[quest_out(q) for q in s.daily],
        weekly_quests=[quest_out(q) for q in s.weekly],
        unseen_badges=[badge_out(b) for b in s.unseen_badges],
    )


# ------------------------------------------------------------------- summary


@router.get(
    "/gamification/summary",
    summary="XP, the daily goal, the streak, gems and quests — secondary to coverage",
    responses=problem_responses(401, 429, 503),
)
async def get_summary(
    principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> GamificationSummary:
    async with session.begin():
        return await _summary(principal, session, container)


# ------------------------------------------------------------------- streak care (docs/10 §5)


async def _streak_row(session: DbSession, learner_id: object) -> Streak:
    row = await session.get(Streak, learner_id, with_for_update=True)
    if row is None:
        row = Streak(
            learner_id=learner_id, current=0, longest=0, freezes=st.MAX_FREEZES, broken_length=0
        )
        session.add(row)
    return row


def _state(row: Streak) -> st.StreakState:
    return st.StreakState(
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


def _store(row: Streak, s: st.StreakState) -> None:
    row.current = s.current
    row.longest = s.longest
    row.paused_from = s.paused_from
    row.paused_until = s.paused_until
    row.broken_on = s.broken_on
    row.broken_length = s.broken_length
    row.repaired_month = s.repaired_month


@router.post(
    "/gamification/streak/repair",
    summary="Repair a broken streak: within 48 h, after a double session today, once a month, free",
    responses=problem_responses(401, 409, 429, 503),
)
async def repair_streak(
    principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> GamificationSummary:
    async with session.begin():
        profile = await _profile(principal, session)
        today = st.local_day(container.clock.now(), profile.tz)
        day = await session.get(LearnerDay, (principal.learner_id, today))
        double = day is not None and day.active_ms >= 2 * profile.daily_goal_min * 60_000
        row = await _streak_row(session, principal.learner_id)
        try:
            repaired = st.repair(_state(row), today, double_session_done=double)
        except st.StreakError as exc:
            raise StreakRuleRefused(str(exc)) from None
        _store(row, repaired)
        row.unseen_reset_from = None
        await session.flush()
        return await _summary(principal, session, container)


@router.post(
    "/gamification/streak/pause",
    summary="Pause the streak for illness or a holiday: 1–30 days, no questions asked",
    responses=problem_responses(401, 409, 422, 429, 503),
)
async def pause_streak(
    body: PauseRequest, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> GamificationSummary:
    async with session.begin():
        profile = await _profile(principal, session)
        today = st.local_day(container.clock.now(), profile.tz)
        row = await _streak_row(session, principal.learner_id)
        try:
            paused = st.pause(_state(row), today, body.days)
        except st.StreakError as exc:
            raise StreakRuleRefused(str(exc)) from None
        _store(row, paused)
        await session.flush()
        return await _summary(principal, session, container)


@router.post(
    "/gamification/streak/resume",
    summary="End a pause early",
    responses=problem_responses(401, 429, 503),
)
async def resume_streak(
    principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> GamificationSummary:
    async with session.begin():
        profile = await _profile(principal, session)
        today = st.local_day(container.clock.now(), profile.tz)
        row = await _streak_row(session, principal.learner_id)
        _store(row, st.resume(_state(row), today))
        await session.flush()
        return await _summary(principal, session, container)


@router.post(
    "/gamification/streak/reset-seen",
    status_code=204,
    response_class=Response,
    summary="The kind reset message was shown; stop sending it",
    responses=problem_responses(401, 429, 503),
)
async def reset_seen(
    principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> Response:
    async with session.begin():
        await GamificationService(session, container.content, container.clock).acknowledge_reset(
            principal.learner_id
        )
    return Response(status_code=204)


@router.post(
    "/gamification/badges/seen",
    status_code=204,
    response_class=Response,
    summary="These passport stamps were celebrated; do not celebrate them again",
    responses=problem_responses(401, 422, 429, 503),
)
async def badges_seen(
    body: BadgesSeenRequest,
    principal: CurrentPrincipal,
    session: DbSession,
    container: ContainerDep,
) -> Response:
    async with session.begin():
        await GamificationService(session, container.content, container.clock).mark_badges_seen(
            principal.learner_id, body.ids
        )
    return Response(status_code=204)


# ------------------------------------------------------------------- settings


@router.patch(
    "/me/settings",
    summary="Change the daily goal, rest days, retention preset and other account settings",
    responses=problem_responses(401, 422, 429, 503),
)
async def patch_settings(
    body: SettingsPatch, principal: CurrentPrincipal, session: DbSession, container: ContainerDep
) -> GamificationSummary:
    """Lowering the daily goal never costs anything (docs/10 §5). A new retention preset
    re-derives every due date from the stored stability, so a replay still matches.

    Leagues (docs/16 E23) are joined here, never by the server: refused for a learner who might
    be under 18, and only with a display name, which may come in the same request. Leaving takes
    the learner out of this week's group at once and keeps their tier for four weeks."""
    if body.rest_days is not None and (
        len(set(body.rest_days)) != len(body.rest_days)
        or not all(1 <= d <= 7 for d in body.rest_days)
    ):
        raise ValidationFailed([FieldError("rest_days", "at most two distinct ISO weekdays (1–7)")])
    name_given = "display_name" in body.model_fields_set
    display_name = None
    if name_given and body.display_name is not None:
        try:
            display_name = normalise_display_name(body.display_name)
        except InvalidDisplayName as exc:
            raise ValidationFailed([FieldError("display_name", str(exc))]) from None
    async with session.begin():
        learner = await session.get(Learner, principal.learner_id, with_for_update=True)
        settings = await session.get(LearnerSettings, principal.learner_id, with_for_update=True)
        if learner is None or settings is None:
            raise InvalidToken("This account no longer exists.")
        if body.daily_goal_min is not None:
            learner.daily_goal_min = body.daily_goal_min
        if body.rest_days is not None:
            settings.rest_days = sorted(body.rest_days)
        if name_given:
            learner.display_name = display_name
        if body.leagues_opt_in is not None and body.leagues_opt_in != settings.leagues_opt_in:
            now = container.clock.now()
            leagues = LeagueService(session, container.clock)
            if body.leagues_opt_in:
                if is_minor(learner.birth_year, st.local_day(now, learner.tz)):
                    raise LeaguesNotForMinors("Leagues are not offered on this account.")
                # a result still waiting is applied first, so the four weeks count from it
                await leagues.catch_up(principal.learner_id)
                settings.league_tier = lg.tier_on_return(
                    settings.league_tier, settings.leagues_left_at, now
                )
                settings.leagues_left_at = None
            else:
                settings.leagues_left_at = now
                await leagues.leave(principal.learner_id)
            settings.leagues_opt_in = body.leagues_opt_in
        if settings.leagues_opt_in and learner.display_name is None:
            raise DisplayNameRequired("Others in a league see a display name; choose one.")
        if body.perfectionist_mode is not None:
            settings.perfectionist_mode = body.perfectionist_mode
        if body.spelling_variant is not None:
            settings.spelling_variant = body.spelling_variant
        if body.training_opt_in is not None:
            settings.training_opt_in = body.training_opt_in
        if body.data_collection_paused is not None:
            settings.data_collection_paused = body.data_collection_paused
        if body.a11y_no_audio is not None:
            settings.a11y_no_audio = body.a11y_no_audio
        if body.a11y_no_vision is not None:
            settings.a11y_no_vision = body.a11y_no_vision
        if body.voice_consent is not None:
            if settings.voice_consent and not body.voice_consent:
                # consent withdrawn: the recordings go with it (docs/11 §10)
                from app.services.speech import delete_recordings

                await delete_recordings(session, principal.learner_id, container.clock.now())
            settings.voice_consent = body.voice_consent
        if (
            body.desired_retention is not None
            and float(settings.desired_retention) != body.desired_retention
        ):
            from decimal import Decimal

            settings.desired_retention = Decimal(str(body.desired_retention))
            repo = ReviewRepository(session)
            ids = await repo.all_memory_item_ids(principal.learner_id)
            for memory_item_id, stored in (await repo.states(principal.learner_id, ids)).items():
                await repo.upsert_state(
                    principal.learner_id,
                    memory_item_id,
                    reschedule(
                        stored.item,
                        learner_id=str(principal.learner_id),
                        memory_item_id=memory_item_id,
                        desired_retention=body.desired_retention,
                    ),
                )
        await session.flush()
        return await _summary(principal, session, container)
