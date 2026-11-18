import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { AwardsOut, BadgeOut, GamificationSummary, GoalOut, QuestOut, SessionSummary, StreakOut } from '@/api/types';
import { syncNow } from '@/outbox/syncer';
import { useAwards } from '@/state/awards';

/**
 * What one lesson earned, assembled only from what the server said (docs/16 E00, E04):
 *   * every award the outbox sync handed back while the lesson was open (answers are synced in
 *     small batches during the lesson, so a lesson's awards arrive in pieces);
 *   * the summary as it was when the lesson opened (the "before" of the ring and the quest bars);
 *   * the summary and the session summary fetched after the closing sync (the "after").
 * The device adds only facts it measured itself — minutes on this screen, words presented — and
 * labels them as such. When the server cannot be reached nothing is guessed.
 */

export const SUMMARY_KEY = ['gamification', 'summary'] as const;

/** Every non-empty award pushed since the component mounted, plus the summary at that moment. */
export function useSessionAwards(): { awards: readonly AwardsOut[]; before: GamificationSummary | null } {
  const qc = useQueryClient();
  const [before] = useState(() => qc.getQueryData<GamificationSummary>([...SUMMARY_KEY]) ?? null);
  const [awards, setAwards] = useState<readonly AwardsOut[]>([]);
  useEffect(
    () =>
      useAwards.subscribe((s, prev) => {
        const latest = s.latest;
        if (latest && latest !== prev.latest) setAwards((list) => [...list, latest.awards]);
      }),
    [],
  );
  return { awards, before };
}

export type CloseSync = 'idle' | 'syncing' | 'slow' | 'sent' | 'failed';

/**
 * The closing sync (docs/16 E00 §1): offered once when the lesson reaches CLOSE. "slow" means the
 * 2.5 s budget passed without an answer — the summary shows its offline face, and still fills in
 * if the answer arrives later.
 */
export function useCloseSync(learnerId: string | null, active: boolean, budgetMs = 2_500): { state: CloseSync; doneAt: number } {
  const qc = useQueryClient();
  // What happened to the sync for this learner; until something did, a running sync is "syncing".
  const [outcome, setOutcome] = useState<{ for: string; state: 'slow' | 'sent' | 'failed'; doneAt: number } | null>(null);
  const running = active && !!learnerId;
  useEffect(() => {
    if (!running || !learnerId) return;
    let alive = true;
    const timer = setTimeout(() => {
      if (alive) setOutcome((o) => o ?? { for: learnerId, state: 'slow', doneAt: 0 });
    }, budgetMs);
    syncNow(learnerId)
      .then((result) => {
        if (!alive) return;
        clearTimeout(timer);
        const ok = result.state === 'sent' || result.state === 'nothing_to_send';
        // Whatever was sent, the numbers are read again now (a sync during the lesson may have
        // carried the last answers already, and then this one had nothing to send).
        if (ok) void qc.invalidateQueries({ queryKey: ['gamification'] });
        setOutcome({ for: learnerId, state: ok ? 'sent' : 'failed', doneAt: Date.now() });
      })
      .catch(() => {
        if (!alive) return;
        clearTimeout(timer);
        setOutcome({ for: learnerId, state: 'failed', doneAt: Date.now() });
      });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [running, learnerId, budgetMs, qc]);
  if (!running) return { state: 'idle', doneAt: 0 };
  const mine = outcome && outcome.for === learnerId ? outcome : null;
  return { state: mine?.state ?? 'syncing', doneAt: mine?.doneAt ?? 0 };
}

export interface MergedAwards {
  xp: number;
  gems: number;
  goal: GoalOut | null;
  goalMetNow: boolean;
  streak: StreakOut | null;
  milestone: number | null;
  questsCompleted: QuestOut[];
  nodes: { node_id: string; tier: number }[];
  units: string[];
  sections: string[];
  badges: BadgeOut[];
}

/** Several sync batches' awards as one: sums for amounts, the latest for states, unions for events. */
export function mergeAwards(list: readonly AwardsOut[]): MergedAwards {
  const out: MergedAwards = {
    xp: 0,
    gems: 0,
    goal: null,
    goalMetNow: false,
    streak: null,
    milestone: null,
    questsCompleted: [],
    nodes: [],
    units: [],
    sections: [],
    badges: [],
  };
  const seen = new Set<string>();
  const once = (key: string) => (seen.has(key) ? false : (seen.add(key), true));
  for (const a of list) {
    out.xp += a.xp;
    out.gems += a.gems;
    if (a.goal) {
      out.goal = a.goal;
      out.goalMetNow ||= a.goal.met_now;
    }
    if (a.streak) {
      out.streak = a.streak;
      if (a.streak.milestone_now) out.milestone = a.streak.milestone_now;
    }
    for (const q of a.quests_completed) if (once(`q:${q.id}`)) out.questsCompleted.push(q);
    for (const n of a.nodes_completed) if (once(`n:${n.node_id}:${n.tier}`)) out.nodes.push(n);
    for (const u of a.units_completed) if (once(`u:${u}`)) out.units.push(u);
    for (const s of a.sections_completed) if (once(`s:${s}`)) out.sections.push(s);
    for (const b of a.badges) if (once(`b:${b.id}`)) out.badges.push(b);
  }
  return out;
}

/** pending: the closing sync is running · online: the server answered · offline: it could not be
 * reached · unavailable: this account or server has no motivation layer yet. */
export type EarnedState = 'pending' | 'online' | 'offline' | 'unavailable';

export interface QuestStep {
  quest: QuestOut;
  /** Progress when the lesson opened (equal to `quest.progress` when it is not known). */
  before: number;
  completedNow: boolean;
}

export interface LessonEarned {
  state: EarnedState;
  /** XP for this lesson's answers (server). Null until known. */
  xp: number | null;
  /** How many of this lesson's answers the server counted, for the honest breakdown line. */
  answers: number | null;
  correct: number | null;
  graded: number | null;
  gems: number;
  goal: { goalMin: number; before: number; after: number; met: boolean; metNow: boolean } | null;
  streak: { current: number; todayCounted: boolean; creditedNow: boolean } | null;
  quests: QuestStep[];
  tiersDone: { node_id: string; tier: number }[];
  unitsDone: string[];
}

export function lessonEarned(input: {
  state: EarnedState;
  awards: readonly AwardsOut[];
  before: GamificationSummary | null;
  after: GamificationSummary | null;
  session: SessionSummary | null;
}): LessonEarned {
  const { state, before, after, session } = input;
  const m = mergeAwards(input.awards);
  const empty: LessonEarned = {
    state,
    xp: null,
    answers: null,
    correct: null,
    graded: null,
    gems: 0,
    goal: null,
    streak: null,
    quests: [],
    tiersDone: [],
    unitsDone: [],
  };
  if (state !== 'online') return empty;

  // "before" belongs to the same local day only; a lesson that crossed midnight starts from zero.
  const sameDay = !!before && (!after || before.today === after.today);
  const goalAfter = after?.goal ?? m.goal;
  const goal = goalAfter
    ? {
        goalMin: goalAfter.goal_min,
        after: goalAfter.minutes_today,
        before: before ? (sameDay ? Math.min(before.goal.minutes_today, goalAfter.minutes_today) : 0) : goalAfter.minutes_today,
        met: goalAfter.met,
        metNow: m.goalMetNow || (!!before && sameDay && !before.goal.met && goalAfter.met),
      }
    : null;

  const streakAfter = after?.streak ?? m.streak;
  const streak = streakAfter
    ? {
        current: streakAfter.current,
        todayCounted: streakAfter.today_counted,
        // Only the first credit of the day ticks the flame; without a "before" nothing animates.
        creditedNow: !!before && streakAfter.today_counted && (!sameDay || !before.streak.today_counted),
      }
    : null;

  const completedIds = new Set(m.questsCompleted.map((q) => q.id));
  const daily = after?.daily_quests ?? (m.questsCompleted.length ? m.questsCompleted.filter((q) => q.period === 'day') : (before?.daily_quests ?? []));
  const quests = daily.map((q) => {
    const was = sameDay ? before?.daily_quests.find((b) => b.id === q.id) : undefined;
    return {
      quest: completedIds.has(q.id) ? { ...q, completed: true, progress: Math.max(q.progress, q.target) } : q,
      before: was ? Math.min(was.progress, q.progress) : before && !sameDay ? 0 : q.progress,
      completedNow: completedIds.has(q.id) || (!!was && !was.completed && q.completed),
    };
  });

  const nodes = [...m.nodes];
  for (const n of session?.nodes_completed ?? []) if (!nodes.some((x) => x.node_id === n.node_id && x.tier === n.tier)) nodes.push(n);

  return {
    state,
    xp: session?.xp ?? m.xp,
    answers: session?.answers ?? null,
    correct: session?.correct ?? null,
    graded: session?.graded ?? null,
    gems: m.gems,
    goal,
    streak,
    quests,
    tiersDone: nodes,
    unitsDone: m.units,
  };
}

/** The summary's state from the closing sync, the account and the server (docs/16 E00). */
export function earnedState(sync: CloseSync, available: boolean): EarnedState {
  if (!available) return 'unavailable';
  switch (sync) {
    case 'idle':
    case 'syncing':
      return 'pending';
    case 'sent':
      return 'online';
    case 'slow':
    case 'failed':
      return 'offline';
  }
}
