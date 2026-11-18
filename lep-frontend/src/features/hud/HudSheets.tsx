import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useEquippedOutfit } from '@/api/queries/assessment';
import type { GamificationSummary } from '@/api/types';
import { Button, Card, Icon, PendingStat, Txt, radius, useTheme } from '@/design';
import { DressedPip } from '@/design/Outfits';
import { QuestRow } from '@/features/quests/QuestRow';
import { usePrefs } from '@/state/prefs';

import { clockTime, nextMilestone, shortDate, streakLook, weekdayNames, wholeMinutes } from './format';
import { GoalRing } from './GoalRing';
import { BottomSheet } from './Sheet';

function openProgress(onClose: () => void) {
  onClose();
  router.push('/progress');
}

/** "As of 14:05" when the numbers are an older snapshot and the device is offline (docs/16 E00 §3). */
export function AsOf({ summary, stale }: { summary: GamificationSummary; stale: boolean }) {
  const { t } = useTranslation();
  const lang = usePrefs((s) => s.interfaceLanguage);
  if (!stale) return null;
  return (
    <Txt variant="caption" color="ink-3" testID="hud-as-of">
      {t('hud.asOf', { time: clockTime(summary.as_of, lang) })}
    </Txt>
  );
}

/**
 * Tapping the streak chip (docs/16 E03): how the streak works — free automatic freezes, rest days,
 * a pause — in plain, kind words, and the way to the full streak page on Progress. No guilt, no
 * countdown, nothing to buy.
 */
export function StreakSheet({ summary, stale, onClose }: { summary: GamificationSummary | null; stale: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const lang = usePrefs((s) => s.interfaceLanguage);
  if (!summary) {
    return (
      <BottomSheet title={t('lessonEnd.streakTitle')} onClose={onClose} testID="streak-sheet">
        <PendingStat icon="flame" tone="streak" title={t('hud.unavailable.title')} body={t('hud.unavailable.body')} />
      </BottomSheet>
    );
  }
  const s = summary.streak;
  const look = streakLook(s, summary.today);
  const next = nextMilestone(s.current);
  return (
    <BottomSheet title={t('hud.streak.title', { count: s.current })} onClose={onClose} testID="streak-sheet">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 64, height: 64, borderRadius: radius.lg, backgroundColor: theme.c['streak-soft'], alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={look === 'rest' ? 'moon' : look === 'paused' ? 'pause' : 'flame'} tone={look === 'today' ? 'color' : 'current'} size={40} color={theme.c['streak-ink']} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="body-m" weight={800}>
            {look === 'today' ? t('lessonEnd.streakCredited') : look === 'rest' ? t('hud.streak.restDay') : look === 'paused' && s.paused_until ? t('hud.streak.pausedUntil', { date: shortDate(s.paused_until, lang) }) : t('hud.streak.how')}
          </Txt>
          <Txt variant="body-s" color="ink-3">
            {t('hud.streak.best', { count: s.longest })}
          </Txt>
        </View>
      </View>
      {look !== 'open' ? (
        <Txt variant="body-s" color="ink-2">
          {t('hud.streak.how')}
        </Txt>
      ) : null}
      <Card soft>
        <View style={{ flexDirection: 'row', gap: 8 }} accessible={false}>
          {[0, 1].map((i) => (
            <View
              key={i}
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: i < s.freezes ? theme.c['gem-soft'] : 'transparent',
                borderWidth: 2,
                borderStyle: i < s.freezes ? 'solid' : 'dashed',
                borderColor: i < s.freezes ? theme.c.gem : theme.c['line-2'],
              }}
            >
              <Icon name="shield" tone={i < s.freezes ? 'color' : 'current'} size={22} color={theme.c['ink-4']} />
            </View>
          ))}
        </View>
        <Txt variant="body-s" color="ink-2" testID="streak-freezes">
          {t('hud.streak.freezes', { count: s.freezes })}
        </Txt>
      </Card>
      <Card soft>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="moon" size={20} color={theme.c['ink-2']} />
          <Txt variant="body-s" weight={800} style={{ flex: 1 }}>
            {t('hud.streak.restDays')}
          </Txt>
        </View>
        <Txt variant="body-s" color="ink-2">
          {s.rest_days.length ? t('hud.streak.restDaysSet', { days: weekdayNames(s.rest_days, lang) }) : t('hud.streak.restDaysNone')}
        </Txt>
      </Card>
      {next ? (
        <Txt variant="body-s" color="ink-3">
          {t('hud.streak.nextMilestone', { count: next })}
        </Txt>
      ) : null}
      <AsOf summary={summary} stale={stale} />
      <Button variant="secondary" block icon="calendar" onPress={() => openProgress(onClose)} testID="streak-open-progress">
        {t('hud.streak.openProgress')}
      </Button>
    </BottomSheet>
  );
}

/**
 * Tapping Pip's ring (docs/16 E02 §2): the goal ring large, today's XP (docs/16 E01 keeps XP off
 * the bar itself), today's and this week's quests, and the reminder that the goal can be lowered
 * at any time.
 */
export function TodaySheet({ summary, stale, onClose }: { summary: GamificationSummary | null; stale: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const outfit = useEquippedOutfit();
  if (!summary) {
    return (
      <BottomSheet title={t('hud.today.title')} onClose={onClose} testID="today-sheet">
        <PendingStat icon="target" tone="xp" title={t('hud.unavailable.title')} body={t('hud.unavailable.body')} />
      </BottomSheet>
    );
  }
  const g = summary.goal;
  const done = wholeMinutes(g.minutes_today);
  return (
    <BottomSheet title={t('hud.today.title')} onClose={onClose} testID="today-sheet">
      <View style={{ alignItems: 'center', gap: 10 }}>
        <View accessible accessibilityRole="progressbar" accessibilityLabel={t(g.met ? 'hud.goal.metA11y' : 'hud.goal.a11y', { done, goal: g.goal_min })}>
          <GoalRing size={168} stroke={14} value={g.minutes_today / Math.max(1, g.goal_min)} met={g.met}>
            <Txt variant="stat" accessible={false}>
              {t('hud.today.minutes', { done, goal: g.goal_min })}
            </Txt>
            <Txt variant="caption" color="ink-3" accessible={false}>
              {t('lessonEnd.goalTitle')}
            </Txt>
          </GoalRing>
        </View>
        {g.met ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <DressedPip outfit={outfit} pose="cheer" size={48} />
            <Txt variant="body-m" weight={800} color="success-ink">
              {t('hud.today.met')}
            </Txt>
          </View>
        ) : done === 0 ? (
          <Txt variant="body-m" color="ink-2" align="center">
            {t('hud.today.fresh')}
          </Txt>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[
          { key: 'xp', text: t('hud.today.xp', { count: summary.xp_today }) },
          { key: 'week', text: t('hud.today.xpWeek', { count: summary.xp_week }) },
        ].map((x) => (
          <View key={x.key} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, borderRadius: radius.md, backgroundColor: theme.c['xp-soft'] }} testID={`today-${x.key}`}>
            <Icon name="star" tone="color" size={18} />
            <Txt variant="body-s" weight={800} rawColor={theme.c['xp-ink']} style={{ flexShrink: 1 }}>
              {x.text}
            </Txt>
          </View>
        ))}
      </View>
      {summary.daily_quests.length ? (
        <View style={{ gap: 6 }}>
          <Txt variant="overline" color="ink-3" accessibilityRole="header">
            {t('quests.today')}
          </Txt>
          {summary.daily_quests.map((q) => (
            <QuestRow key={q.id} quest={q} />
          ))}
        </View>
      ) : null}
      {summary.weekly_quests.length ? (
        <View style={{ gap: 6 }}>
          <Txt variant="overline" color="ink-3" accessibilityRole="header">
            {t('quests.week')}
          </Txt>
          {summary.weekly_quests.map((q) => (
            <QuestRow key={q.id} quest={q} />
          ))}
        </View>
      ) : null}
      <Txt variant="body-s" color="ink-3">
        {t('hud.today.lowerGoal')}
      </Txt>
      <AsOf summary={summary} stale={stale} />
      <Button variant="secondary" block icon="chart" onPress={() => openProgress(onClose)} testID="today-open-progress">
        {t('hud.today.openProgress')}
      </Button>
    </BottomSheet>
  );
}
