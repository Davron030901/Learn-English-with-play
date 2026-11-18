import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDueReviews } from '@/api/queries/gamification';
import type { ProgressOut } from '@/api/types';
import { preloadSfx, sfx } from '@/audio/sfx';
import { content, useCourse, useWords } from '@/content/queries';
import { Button, Mascot, Txt, useTheme, type MascotPose } from '@/design';
import { ProblemNotice, asProblem } from '@/features/errors';
import { dueFromWindow, loadDueWindow } from '@/features/garden/offlineWindow';
import { planReview, reviewHints, type ReviewPlan, type ReviewQueue } from '@/features/garden/reviewQueue';
import { useWatering } from '@/features/garden/watering';
import { LessonRunner } from '@/features/lesson/LessonRunner';
import { serverState } from '@/features/progress/serverState';
import { log } from '@/lib/log';
import { getOutbox } from '@/outbox';
import { syncNow } from '@/outbox/syncer';
import { useLearner } from '@/state/learner';
import { isOnline, useOnlineStore } from '@/state/online';
import { usePrefs } from '@/state/prefs';

/** About a 4–5 minute watering (docs/08 §5 review budget). */
const REVIEW_LIMIT = 15;

function backToGarden() {
  if (router.canGoBack()) router.back();
  else router.replace('/practice');
}

function Calm({ pose, title, body, testID, children }: { pose: MascotPose; title: string; body?: string; testID: string; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.c.bg }}>
      <View testID={testID} accessibilityLiveRegion="polite" style={{ flex: 1, padding: 24, gap: 16, alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 520, alignSelf: 'center' }}>
        <Mascot pose={pose} size={132} />
        <Txt variant="title-l" align="center" accessibilityRole="header">
          {title}
        </Txt>
        {body ? (
          <Txt variant="body-l" color="ink-2" align="center">
            {body}
          </Txt>
        ) : null}
        <View style={{ gap: 10, alignSelf: 'stretch' }}>{children}</View>
      </View>
    </SafeAreaView>
  );
}

/**
 * /review — watering the garden (docs/16 E09). The server's scheduler chooses what is due
 * (GET /v1/reviews/due) and with which exercise; this route only finds those items in the packed
 * content, orders them for the screen (warm-up first, docs/07 §3.2) and runs them through the
 * lesson runner, whose answers go to the outbox like any lesson's. Composition happens once per
 * visit: a refetch of the queue while the learner answers never changes the session underneath.
 *
 * When the server cannot be asked (offline, or it fails), the queue is what the last sync said
 * would be due by now (the saved seven-day window, features/garden/offlineWindow.ts) — the
 * server's own dates and exercises, never a schedule made on the device. With no saved window,
 * the route says so calmly rather than invent a queue.
 */
export default function ReviewRoute() {
  const { t } = useTranslation();
  const due = useDueReviews(REVIEW_LIMIT);
  const course = useCourse();
  const words = useWords();
  const learnerId = useLearner((s) => s.learnerId);
  const online = useOnlineStore(isOnline);
  const queryClient = useQueryClient();
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 30));
  const [attempt, setAttempt] = useState(0);
  const [plan, setPlan] = useState<ReviewPlan | null>(null);
  const [planError, setPlanError] = useState<unknown>(null);
  const planning = useRef(false);
  const answered = useRef(new Set<string>());

  useEffect(() => {
    preloadSfx(['water']);
  }, []);

  // Without the server: the saved window's reviews that have come due, minus any this device
  // has answered since the window was saved (undefined while it is being read; null if none).
  const dueState = serverState(due);
  const serverUnavailable = !due.data && (due.isError || dueState === 'unavailable');
  const [saved, setSaved] = useState<ReviewQueue | null | undefined>(undefined);
  useEffect(() => {
    if (!learnerId || !serverUnavailable || saved !== undefined) return;
    let alive = true;
    void (async () => {
      const window = await loadDueWindow(learnerId);
      if (!window) {
        if (alive) setSaved(null);
        return;
      }
      const rows = await getOutbox(learnerId).list();
      const answeredSince = new Set(rows.flatMap((r) => (r.kind === 'review' && r.created_at >= window.asOf ? [r.payload.item_id] : [])));
      if (alive) setSaved(dueFromWindow(window, new Date(), answeredSince, REVIEW_LIMIT));
    })().catch((e: unknown) => {
      log.warn('review.window_failed', e);
      if (alive) setSaved(null);
    });
    return () => {
      alive = false;
    };
  }, [learnerId, serverUnavailable, saved]);

  const queue: ReviewQueue | undefined = due.data ?? saved ?? undefined;
  const unitOrder = useMemo(() => course.data?.sections.flatMap((s) => s.units.map((u) => u.id)) ?? [], [course.data]);

  useEffect(() => {
    if (plan || planning.current || !queue || queue.items.length === 0 || unitOrder.length === 0) return;
    planning.current = true;
    const prefs = usePrefs.getState();
    const hints = reviewHints(useLearner.getState().data.completed, queryClient.getQueryData<ProgressOut>(['progress']));
    planReview(queue, {
      unitOrder,
      hints,
      loadUnit: (id) => content.loadUnit(id),
      profile: { noAudio: prefs.noAudio, noVision: prefs.noVision },
      seed,
    })
      .then((p) => {
        if (p.missing.length) log.info('review.items_missing', { count: p.missing.length });
        setPlan(p);
      })
      .catch((e: unknown) => {
        log.warn('review.plan_failed', e);
        setPlanError(e);
      })
      .finally(() => {
        planning.current = false;
      });
  }, [plan, queue, unitOrder, queryClient, seed, attempt]);

  // Which of this session's items the learner actually answered: read back from the outbox, where
  // every answer is stored the moment it is given. Those plants get the watering animation.
  const session = plan?.session ?? null;
  useEffect(() => {
    if (!learnerId || !session) return;
    const ids = new Set(session.steps.flatMap((s) => (s.kind === 'item' ? [s.item.id] : [])));
    const since = new Date().toISOString();
    const box = getOutbox(learnerId);
    let alive = true;
    const refresh = () => {
      void box.list().then((rows) => {
        if (!alive) return;
        for (const r of rows) if (r.kind === 'review' && ids.has(r.payload.item_id) && r.created_at >= since) answered.current.add(r.payload.item_id);
      });
    };
    const unsub = box.subscribe(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, [learnerId, session]);

  const leave = useCallback(() => {
    const plants = [...answered.current].flatMap((id) => plan?.plantsByItem.get(id) ?? []);
    if (answered.current.size > 0) {
      sfx('water');
      useWatering.getState().record(plants);
      if (learnerId) void syncNow(learnerId);
    }
    backToGarden();
  }, [plan, learnerId]);

  if (serverUnavailable && saved === undefined && learnerId) {
    return <Calm pose="listen" title={t('review.title')} body={t('review.loading')} testID="review-loading" />;
  }

  if (due.isError && !queue) {
    return (
      <Calm pose="think" title={online ? t('review.title') : t('review.offlineTitle')} body={online ? undefined : t('review.offlineBody')} testID="review-error">
        {online ? <ProblemNotice problem={asProblem(due.error)} onRetry={() => void due.refetch()} /> : null}
        <Button variant="secondary" block onPress={backToGarden}>
          {t('review.backToGarden')}
        </Button>
      </Calm>
    );
  }

  if (dueState === 'unavailable' && !queue) {
    return (
      <Calm pose="rest" title={t('review.offlineTitle')} body={t('review.offlineBody')} testID="review-offline">
        <Button block onPress={backToGarden}>
          {t('review.backToGarden')}
        </Button>
      </Calm>
    );
  }

  if (queue && (queue.items.length === 0 || (plan && !plan.session))) {
    return (
      <Calm pose="happy" title={t('review.wateredTitle')} body={t('review.wateredBody')} testID="review-empty">
        {plan && plan.missing.length > 0 ? (
          <Txt variant="body-s" color="ink-3" align="center">
            {t('review.notOnDevice')}
          </Txt>
        ) : null}
        <Button block onPress={backToGarden} testID="review-back">
          {t('review.backToGarden')}
        </Button>
        <Button variant="secondary" block icon="book" onPress={() => router.replace('/library')}>
          {t('garden.toLibrary')}
        </Button>
      </Calm>
    );
  }

  const error = planError ?? course.error ?? words.error;
  if (error) {
    return (
      <Calm pose="think" title={t('review.title')} testID="review-error">
        <ProblemNotice
          problem={asProblem(error)}
          onRetry={() => {
            setPlanError(null);
            setAttempt((n) => n + 1);
            void course.refetch();
            void words.refetch();
          }}
        />
        <Button variant="secondary" block onPress={backToGarden}>
          {t('review.backToGarden')}
        </Button>
      </Calm>
    );
  }

  if (!session || !course.data || !words.data || !learnerId) {
    return <Calm pose="listen" title={t('review.title')} body={t('review.loading')} testID="review-loading" />;
  }

  return (
    <LessonRunner
      key={session.id}
      session={session}
      units={plan?.units ?? new Map()}
      words={words.data}
      course={course.data}
      onLeave={leave}
      onNext={() => leave()}
    />
  );
}
