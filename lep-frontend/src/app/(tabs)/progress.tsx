import { router } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  serverHasGamification,
  useGamificationSummary,
  useMarkBadgesSeen,
  useProgress,
} from '@/api/queries/gamification';
import { useMe } from '@/api/queries/me';
import { useCourse } from '@/content/queries';
import {
  Card,
  HonestTimeline,
  LevelBadge,
  PendingStat,
  Screen,
  SectionTitle,
  TextLink,
  Txt,
} from '@/design';
import { currentPosition } from '@/features/path/position';
import { Appear } from '@/features/progress/Appear';
import { CoverageCard } from '@/features/progress/CoverageCard';
import { LevelCard } from '@/features/progress/LevelCard';
import { LevelConditionsCard } from '@/features/progress/LevelConditionsCard';
import { Passport } from '@/features/progress/Passport';
import { formatTime, serverState, type ServerState } from '@/features/progress/serverState';
import { XpCard } from '@/features/progress/XpCard';
import { StreakCare } from '@/features/streak/StreakCare';
import { completedMap, useLearner } from '@/state/learner';
import { usePrefs } from '@/state/prefs';

/** While a figure is on its way: a quiet line, never a placeholder number. */
function Waiting({ title, testID }: { title: string; testID: string }) {
  const { t } = useTranslation();
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <Txt variant="body-s" color="ink-3" accessibilityLiveRegion="polite" testID={testID}>
        {t('common.loading')}
      </Txt>
    </Card>
  );
}

/**
 * Progress (docs/16 E15, docs/10 §4.1): coverage first — "everyday English you understand" is
 * the number that matters — then the level, streak care and XP last among the numbers, then the
 * English Passport. Every figure is the server's (GET /v1/progress, GET /v1/gamification/summary);
 * when the server cannot be reached or does not offer them yet, each shows "Not available yet"
 * with the reason, because showing nothing beats showing a guess (brief §0 rule 8). Where the
 * learner is on the path and how long the course really takes are facts this device can state.
 */
export default function ProgressScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const course = useCourse();
  const progress = useProgress();
  const summary = useGamificationSummary();
  const markSeen = useMarkBadgesSeen();
  const language = usePrefs((s) => s.interfaceLanguage);
  const data = useLearner((s) => s.data);
  const completed = useMemo(() => completedMap(data), [data]);
  const position = useMemo(
    () => (course.data ? currentPosition(course.data, completed, data.startSection) : null),
    [course.data, completed, data.startSection],
  );
  const goal = summary.data?.goal.goal_min ?? me.data?.daily_goal_min ?? null;
  const compare = goal === null ? [20, 60] : goal >= 60 ? [goal, 20] : [goal, 60];

  const progressState: ServerState = serverState(progress);
  const summaryState: ServerState = serverState(summary);
  const p = progress.data;
  const s = summary.data;

  // New stamps are marked seen once the Passport has shown them; they keep their "New" tag for
  // the rest of this visit (the ids just sent), then the server's list is the record again.
  const { mutate: markBadgesSeen } = markSeen;
  const unseenKey = useMemo(
    () =>
      (s?.unseen_badges ?? [])
        .map((b) => b.id)
        .sort()
        .join(','),
    [s?.unseen_badges],
  );
  const sentKey = useRef('');
  useEffect(() => {
    if (!unseenKey || progressState !== 'ready' || sentKey.current === unseenKey) return;
    sentKey.current = unseenKey;
    markBadgesSeen(unseenKey.split(','));
  }, [unseenKey, progressState, markBadgesSeen]);
  const newIds = useMemo(
    () => new Set([...(s?.unseen_badges ?? []).map((b) => b.id), ...(markSeen.variables ?? [])]),
    [s?.unseen_badges, markSeen.variables],
  );
  const unseen = useMemo(
    () => (p?.badges ?? []).filter((b) => newIds.has(b.id)),
    [p?.badges, newIds],
  );

  const asOf = s ? formatTime(s.as_of, language) : '';
  const fetching = progress.isFetching || summary.isFetching;

  return (
    <Screen edges={['top']} testID="progress">
      <View style={{ gap: 4 }}>
        <Txt variant="display-m" accessibilityRole="header">
          {t('progress.title')}
        </Txt>
        {progressState === 'ready' || summaryState === 'ready' ? (
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12 }}
          >
            {asOf ? (
              <Txt variant="caption" color="ink-3" testID="progress-as-of">
                {t('progressScreen.asOf', { time: asOf })}
              </Txt>
            ) : null}
            <TextLink
              icon="refresh"
              onPress={() => {
                if (fetching) return;
                void progress.refetch();
                void summary.refetch();
              }}
              testID="progress-refresh"
            >
              {t('progressScreen.refresh')}
            </TextLink>
          </View>
        ) : null}
      </View>

      {/* 1. Coverage — the headline. */}
      {p ? (
        <Appear testID="progress-coverage">
          <CoverageCard coverage={p.coverage} />
        </Appear>
      ) : progressState === 'loading' ? (
        <Waiting title={t('progress.coverageTitle')} testID="coverage-loading" />
      ) : (
        <PendingStat
          icon="eye"
          tone="primary"
          title={t('progress.coverageTitle')}
          body={
            serverHasGamification
              ? t('progressScreen.coverageUnavailable')
              : t('progress.coverageWaiting')
          }
        />
      )}

      {/* 2. Level. */}
      {p ? (
        <Appear>
          <LevelCard level={p.level} />
        </Appear>
      ) : progressState === 'loading' ? (
        <Waiting title={t('progress.levelTitle')} testID="level-loading" />
      ) : (
        <PendingStat
          icon="medal"
          tone="purple"
          title={t('progress.levelTitle')}
          body={
            serverHasGamification
              ? t('progressScreen.levelUnavailable')
              : t('progress.levelWaiting')
          }
        />
      )}
      {p ? <LevelConditionsCard cefr={p.level.cefr} /> : null}

      <Card>
        <SectionTitle>{t('progress.whereTitle')}</SectionTitle>
        {position && position.started ? (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <LevelBadge level={position.unit.cefr} />
            <Txt variant="body-m" style={{ flex: 1 }} testID="where">
              {t('progress.whereBody', {
                section: Number(position.unit.sectionId.slice(1)),
                unit: position.unit.index,
                title: position.unit.title.en,
              })}
            </Txt>
          </View>
        ) : (
          <Txt variant="body-m" color="ink-2" testID="where">
            {t('progress.whereNone')}
          </Txt>
        )}
        {position ? (
          <TextLink
            icon="book"
            onPress={() =>
              router.push({ pathname: '/unit/[unitId]', params: { unitId: position.unit.id } })
            }
          >
            {t('path.notes')}
          </TextLink>
        ) : null}
        <Txt variant="caption" color="ink-3">
          {t('path.progressNote')}
        </Txt>
      </Card>

      {/* 3. Streak care, then XP — last among the numbers. */}
      {s ? (
        <Appear testID="progress-streak">
          <View style={{ gap: 20 }}>
            <StreakCare streak={s.streak} today={s.today} />
            <XpCard summary={s} />
          </View>
        </Appear>
      ) : summaryState === 'loading' ? (
        <Waiting title={t('progress.streakTitle')} testID="streak-loading" />
      ) : (
        <PendingStat
          icon="flame"
          tone="streak"
          title={t('progress.streakTitle')}
          body={
            serverHasGamification
              ? t('progressScreen.streakUnavailable')
              : t('progress.streakWaiting')
          }
        />
      )}

      {/* 4. The English Passport: earned can-do stamps, from the same server record. */}
      {p ? (
        <Appear testID="progress-passport">
          <Passport badges={p.badges} unseen={unseen} course={course.data} />
        </Appear>
      ) : null}

      <Card>
        <SectionTitle>{t('progress.timelineTitle')}</SectionTitle>
        <HonestTimeline minutes={compare} />
      </Card>
    </Screen>
  );
}
