import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View, useWindowDimensions, type PressableStateCallbackType } from 'react-native';

import { useEquippedOutfit } from '@/api/queries/assessment';
import type { GamificationSummary } from '@/api/types';
import { Icon, LevelBadge, Logo, Txt, radius, useTheme, type IconName } from '@/design';
import { DressedPip } from '@/design/Outfits';

import { streakLook, wholeMinutes, type StreakLook } from './format';
import { GoalRing } from './GoalRing';

type State = PressableStateCallbackType & { focused?: boolean };

const LOOK_ICON: Record<StreakLook, IconName> = { today: 'flame', open: 'flame', rest: 'moon', paused: 'pause' };

/** The accessible name of the streak chip: the number first, then today's state in words. */
export function useStreakLabel(summary: GamificationSummary | null): string {
  const { t } = useTranslation();
  if (!summary) return t('hud.streak.unavailable');
  const look = streakLook(summary.streak, summary.today);
  const state = { today: t('hud.streak.today'), open: t('hud.streak.notYet'), rest: t('hud.streak.restDay'), paused: t('hud.streak.paused') }[look];
  return `${t('hud.streak.label', { count: summary.streak.current })}, ${state}`;
}

/**
 * The streak chip (docs/16 E03 §1): a 36 px pill with a 44 px hit area. Credited today = the
 * colour flame and a heavy number; not yet today = a quiet grey flame (never red, never "at
 * risk"); a rest day shows the moon; a pause shows the pause sign.
 */
export const StreakChip = memo(function StreakChip({ summary, onPress }: { summary: GamificationSummary | null; onPress: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const label = useStreakLabel(summary);
  const look: StreakLook | null = summary ? streakLook(summary.streak, summary.today) : null;
  const lit = look === 'today';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('hud.streak.openHint')}
      hitSlop={4}
      testID="hud-streak"
      style={(s: State) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        height: 36,
        minWidth: 44,
        paddingHorizontal: 10,
        borderRadius: radius.full,
        backgroundColor: s.pressed ? theme.c['bg-soft'] : theme.c.surface,
        borderWidth: 2,
        borderColor: theme.c.line,
        boxShadow: [theme.lip(theme.c['line-2'], 2), s.focused ? theme.focusRing : null].filter(Boolean).join(', '),
      })}
    >
      {look ? (
        <Icon name={LOOK_ICON[look]} tone={lit ? 'color' : 'current'} size={20} color={look === 'open' ? theme.c['ink-4'] : theme.c['streak-ink']} />
      ) : (
        <Icon name="flame" size={20} color={theme.c['ink-4']} />
      )}
      <Txt variant="label" weight={lit ? 900 : 800} rawColor={lit ? theme.c['streak-ink'] : theme.c['ink-2']} style={{ fontSize: 16, lineHeight: 20 }}>
        {summary ? String(summary.streak.current) : '–'}
      </Txt>
    </Pressable>
  );
});

/** Gems: earned only, spendable on cosmetics, never on learning (docs/10 §9). Informational. */
export const GemChip = memo(function GemChip({ gems }: { gems: number }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityLabel={t('hud.gems.label', { count: gems })}
      testID="hud-gems"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingHorizontal: 10, borderRadius: radius.full, backgroundColor: theme.c['gem-soft'] }}
    >
      <Icon name="gem" tone="color" size={18} />
      <Txt variant="label" weight={900} rawColor={theme.c['gem-ink']} style={{ fontSize: 16, lineHeight: 20 }}>
        {String(gems)}
      </Txt>
    </View>
  );
});

/** Whether Pip has cheered for today's ring in this app run (once per day, docs/16 E02 §1). */
let cheeredFor: string | null = null;
const CHEER_DELAY_MS = 250;

/** Pip inside the daily-goal ring (docs/16 E02 §1): 40 × 40, the head 28 px. */
export const GoalButton = memo(function GoalButton({ summary, onPress }: { summary: GamificationSummary | null; onPress: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const outfit = useEquippedOutfit();
  const goal = summary?.goal ?? null;
  const met = !!goal?.met;
  const today = summary?.today ?? null;
  const [cheering, setCheering] = useState(false);
  // Pip cheers for one second once the ring closes — a beat after it is drawn, once a day.
  useEffect(() => {
    if (!met || !today || cheeredFor === today) return;
    cheeredFor = today;
    let started = false;
    const start = setTimeout(() => {
      started = true;
      setCheering(true);
    }, CHEER_DELAY_MS);
    const stop = setTimeout(() => setCheering(false), CHEER_DELAY_MS + 1_000);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
      // Unmounted before the cheer began: it is still owed (and Strict Mode's double run keeps it).
      if (!started) cheeredFor = null;
    };
  }, [met, today]);
  const cheer = cheering && met;
  const done = goal ? wholeMinutes(goal.minutes_today) : 0;
  const label = goal
    ? t(met ? 'hud.goal.metA11y' : 'hud.goal.a11y', { done: Math.min(done, met ? done : goal.goal_min), goal: goal.goal_min })
    : t('hud.goal.unavailable');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('hud.goal.openHint')}
      hitSlop={2}
      testID="hud-goal"
      style={(s: State) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, boxShadow: s.focused ? theme.focusRing : 'none' })}
    >
      <GoalRing size={40} value={goal ? goal.minutes_today / Math.max(1, goal.goal_min) : 0} met={met} animate={false}>
        <DressedPip outfit={outfit} pose={cheer ? 'cheer' : 'happy'} size={28} />
      </GoalRing>
    </Pressable>
  );
});

/**
 * The path's top bar (docs/16 E08 §1, E02, E03): the level on the start side; the streak, gems and
 * Pip in the goal ring on the end side. Every number comes from GET /v1/gamification/summary;
 * without it the chips stay quiet ("–", an empty ring) and their labels say "not available yet".
 */
export function HudBar({
  title,
  level,
  summary,
  onStreak,
  onGoal,
}: {
  title: string;
  level: string | null;
  summary: GamificationSummary | null;
  onStreak: () => void;
  onGoal: () => void;
}) {
  const { width } = useWindowDimensions();
  const roomy = width >= 430;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, paddingHorizontal: 16, paddingVertical: 6 }} testID="hud">
      <Logo variant="mark" size={roomy ? 18 : 15} />
      <Txt
        variant="title-m"
        accessibilityRole="header"
        numberOfLines={1}
        style={roomy ? { flex: 1 } : { flex: 1, opacity: 0, width: 1 }}
      >
        {title}
      </Txt>
      {level ? <LevelBadge level={level} size={roomy ? 'md' : 'sm'} /> : null}
      <StreakChip summary={summary} onPress={onStreak} />
      {summary ? <GemChip gems={summary.gems} /> : null}
      <GoalButton summary={summary} onPress={onGoal} />
    </View>
  );
}
