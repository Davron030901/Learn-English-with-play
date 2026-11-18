import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useAcknowledgeReset, usePauseStreak, useRepairStreak, useResumeStreak } from '@/api/queries/gamification';
import type { StreakOut } from '@/api/types';
import { sfx } from '@/audio/sfx';
import { Button, Card, Chip, Icon, IconButton, Mascot, Notice, SectionTitle, TextLink, Txt, useTheme } from '@/design';
import { RequestId, asProblem } from '@/features/errors';
import { formatDay, isoWeekday, weekdayName } from '@/features/progress/serverState';
import { isOnline, useOnlineStore } from '@/state/online';
import { usePrefs } from '@/state/prefs';

import { Snowflake } from './Snowflake';

/** docs/10 §5: freezes held at most, milestones, and the pause range. */
const FREEZE_SLOTS = 2;
const MILESTONES = [7, 30, 100, 365] as const;
const PAUSE_MIN = 1;
const PAUSE_MAX = 30;
const PAUSE_DEFAULT = 7;

/** A failed action, said kindly: nothing changed, try again; plus the request id for support. */
function ActionFailed({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 6 }} accessibilityLiveRegion="polite" testID="streak-action-failed">
      <Notice icon="info" tone="orange">
        {t('streakCare.actionFailed')}
      </Notice>
      <RequestId id={asProblem(error).requestId} />
    </View>
  );
}

/**
 * Streak care (docs/16 E03, docs/10 §5): the streak, its free automatic freezes, rest days,
 * repair and pause — every value the server's, every word kind. No countdown, no "at risk", no
 * "are you sure?": pausing is one tap and applies at once.
 */
export function StreakCare({ streak, today }: { streak: StreakOut; today: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnlineStore(isOnline);
  const language = usePrefs((s) => s.interfaceLanguage);
  const [days, setDays] = useState(PAUSE_DEFAULT);
  const [repairStarted, setRepairStarted] = useState(false);
  const pause = usePauseStreak();
  const resume = useResumeStreak();
  const repair = useRepairStreak();
  const ackReset = useAcknowledgeReset();

  const weekday = isoWeekday(today);
  const restToday = weekday !== null && streak.rest_days.includes(weekday);
  const paused = streak.paused_until !== null;
  const next = MILESTONES.find((m) => m > streak.current);
  const resetDays = streak.reset_message ? /(\d+)/.exec(streak.reset_message)?.[1] : undefined;
  const busy = pause.isPending || resume.isPending || repair.isPending;
  const failed = pause.error ?? resume.error ?? repair.error ?? ackReset.error;

  const status = paused
    ? { icon: 'pause' as const, text: t('streakCare.pausedUntil', { date: formatDay(streak.paused_until ?? '', language) }) }
    : streak.today_counted
      ? { icon: 'check-circle' as const, text: t('streakCare.todayCounted') }
      : restToday
        ? { icon: 'moon' as const, text: t('streakCare.todayRest') }
        : { icon: 'calendar' as const, text: t('streakCare.todayOpen') };

  return (
    <View style={{ gap: 12 }} testID="streak">
      {streak.reset_message ? (
        <Card soft>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Mascot pose="wave" size={64} />
            <Txt variant="body-m" style={{ flex: 1 }} testID="streak-reset">
              {resetDays ? t('streakCare.reset', { count: Number(resetDays) }) : streak.reset_message}
            </Txt>
          </View>
          <Button variant="secondary" size="sm" busy={ackReset.isPending} disabled={!online} onPress={() => ackReset.mutate()}>
            {t('streakCare.resetSeen')}
          </Button>
        </Card>
      ) : null}

      <Card>
        <View
          accessible
          accessibilityLabel={t('streakCare.a11y', { count: streak.current, best: streak.longest })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}
        >
          <View style={{ width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.c['streak-soft'] }}>
            {streak.today_counted ? <Icon name="flame" tone="color" size={38} /> : <Icon name={paused ? 'pause' : 'flame'} size={34} color={theme.c['streak-ink']} />}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="title-m" testID="streak-current">
              {t('streakCare.days', { count: streak.current })}
            </Txt>
            <Txt variant="body-s" color="ink-2">
              {t('streakCare.best', { count: streak.longest })}
            </Txt>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name={status.icon} size={18} color={theme.c['ink-2']} />
          <Txt variant="body-s" color="ink-2" style={{ flex: 1 }} testID="streak-today">
            {status.text}
          </Txt>
        </View>
        {next ? (
          <Txt variant="caption" color="ink-3">
            {t('streakCare.nextMilestone', { count: next })}
          </Txt>
        ) : null}

        <View style={{ gap: 8, paddingTop: 4 }}>
          <Txt variant="body-m" weight={800}>
            {t('streakCare.freezesTitle')}
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 6 }} testID="freezes">
              {Array.from({ length: FREEZE_SLOTS }, (_, i) => (
                <View
                  key={i}
                  accessible
                  accessibilityLabel={i < streak.freezes ? t('streakCare.freezeReady') : t('streakCare.freezeComing')}
                  style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: i < streak.freezes ? theme.c['gem-soft'] : theme.c['bg-soft'] }}
                >
                  <Snowflake ready={i < streak.freezes} color={theme.c['gem-ink']} track={theme.c['line-2']} />
                </View>
              ))}
            </View>
            <Txt variant="body-s" color="ink-2" style={{ flex: 1 }}>
              {t('streakCare.freezes', { count: Math.min(streak.freezes, FREEZE_SLOTS) })}
            </Txt>
          </View>
        </View>

        <View style={{ gap: 8, paddingTop: 4 }}>
          <Txt variant="body-m" weight={800}>
            {t('streakCare.restTitle')}
          </Txt>
          {streak.rest_days.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {[...streak.rest_days].sort().map((d) => (
                <Chip key={d} icon="moon" tone="purple" size="sm">
                  {weekdayName(d, language)}
                </Chip>
              ))}
            </View>
          ) : (
            <Txt variant="body-s" color="ink-3">
              {t('streakCare.restNone')}
            </Txt>
          )}
          <Txt variant="caption" color="ink-3">
            {t('streakCare.restBody')}
          </Txt>
          <TextLink icon="sliders" onPress={() => router.push({ pathname: '/settings/[page]', params: { page: 'learning' } })} testID="rest-days-change">
            {t('streakCare.restChange')}
          </TextLink>
        </View>
      </Card>

      {streak.can_repair && !repairStarted ? (
        <Card>
          <SectionTitle>{t('streakCare.repairTitle')}</SectionTitle>
          <Txt variant="body-s" color="ink-2">
            {t('streakCare.repairBody')}
          </Txt>
          <Button
            variant="secondary"
            block
            icon="refresh"
            busy={repair.isPending}
            disabled={!online || busy}
            onPress={() =>
              repair.mutate(undefined, {
                onSuccess: () => {
                  setRepairStarted(true);
                  sfx('pop');
                },
              })
            }
            testID="streak-repair"
          >
            {t('streakCare.repairButton')}
          </Button>
        </Card>
      ) : null}
      {repairStarted ? (
        <View accessibilityLiveRegion="polite">
          <Notice icon="check" tone="green">
            {t('streakCare.repairStarted')}
          </Notice>
        </View>
      ) : null}

      <Card>
        <SectionTitle>{t('streakCare.pauseTitle')}</SectionTitle>
        {paused ? (
          <>
            <Txt variant="body-m" weight={800} testID="streak-paused">
              {t('streakCare.pausedUntil', { date: formatDay(streak.paused_until ?? '', language) })}
            </Txt>
            <Txt variant="body-s" color="ink-2">
              {t('streakCare.pausedBody')}
            </Txt>
            <Button block icon="play" busy={resume.isPending} disabled={!online || busy} onPress={() => resume.mutate(undefined, { onSuccess: () => sfx('pop') })} testID="streak-resume">
              {t('streakCare.resume')}
            </Button>
          </>
        ) : (
          <>
            <Txt variant="body-s" color="ink-2">
              {t('streakCare.pauseBody')}
            </Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <IconButton icon="chevron-left" variant="secondary" label={t('streakCare.fewerDays')} disabled={days <= PAUSE_MIN} onPress={() => setDays((d) => Math.max(PAUSE_MIN, d - 1))} testID="pause-fewer" />
              <Txt variant="stat-s" align="center" style={{ minWidth: 96 }} accessibilityLiveRegion="polite" testID="pause-days">
                {t('streakCare.pauseDays', { count: days })}
              </Txt>
              <IconButton icon="chevron-right" variant="secondary" label={t('streakCare.moreDays')} disabled={days >= PAUSE_MAX} onPress={() => setDays((d) => Math.min(PAUSE_MAX, d + 1))} testID="pause-more" />
            </View>
            <Button variant="secondary" block icon="pause" busy={pause.isPending} disabled={!online || busy} onPress={() => pause.mutate(days, { onSuccess: () => sfx('pop') })} testID="streak-pause">
              {t('streakCare.pauseFor', { count: days })}
            </Button>
          </>
        )}
        {!online ? (
          <Txt variant="caption" color="ink-3">
            {t('streakCare.needsConnection')}
          </Txt>
        ) : null}
      </Card>

      {failed ? <ActionFailed error={failed} /> : null}
    </View>
  );
}
