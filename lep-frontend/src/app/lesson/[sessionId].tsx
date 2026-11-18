import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthStatus } from '@/api/queries/me';
import {
  requestNodeSession,
  serverHasSessions,
  type NodeSessionResult,
} from '@/api/queries/sessions';
import type { Tier, Unit } from '@/content/model';
import { content, useCourse, useUnit, useWords } from '@/content/queries';
import { Button, Mascot, Txt, useTheme, type MascotPose } from '@/design';
import { ProblemNotice, asProblem } from '@/features/errors';
import { dayAndTime } from '@/features/hud/format';
import { LessonRunner } from '@/features/lesson/LessonRunner';
import { tierMinutes } from '@/features/path/NodeSheet';
import { unitIdOfNode } from '@/features/path/position';
import { log } from '@/lib/log';
import {
  composeNodeSession,
  parseSessionId,
  sessionIdFor,
  type ComposedSession,
} from '@/runner/compose';
import { takeOver } from '@/runner/pending';
import { deviceGate, fromServerPlan, planUnitIds } from '@/runner/serverSession';
import { countEvent } from '@/state/clientEvents';
import { completedMap, useLearner } from '@/state/learner';
import { isOnline, useOnlineStore } from '@/state/online';
import { usePrefs } from '@/state/prefs';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Module-level so TanStack keeps the result (and its Map) stable between renders unless a unit
 * query changes — the server plan is built from it once.
 */
function combineUnits(results: UseQueryResult<Unit>[]) {
  return {
    map: new Map(results.flatMap((r) => (r.data ? [[r.data.id, r.data] as [string, Unit]] : []))),
    pending: results.some((r) => r.isPending),
    error: results.find((r) => r.error)?.error ?? null,
    refetch: () => results.forEach((r) => void r.refetch()),
  };
}

/** Extra minutes asked for beyond the tier itself, for the due reviews the server mixes in. */
const REVIEW_ROOM_MIN = 3;

function Calm({
  pose,
  title,
  body,
  testID,
  children,
}: {
  pose: MascotPose;
  title: string;
  body?: string;
  testID: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.c.bg }}>
      <View
        testID={testID}
        accessibilityLiveRegion="polite"
        style={{
          flex: 1,
          padding: 24,
          gap: 16,
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          maxWidth: 520,
          alignSelf: 'center',
        }}
      >
        <Mascot pose={pose} size={120} />
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
 * /lesson/:sessionId — a node-tier ("S01U01N1.t1") or a session another screen composed and
 * handed over (Practice).
 *
 * A node-tier is composed by the server when it can be asked (POST /v1/sessions, docs/08 §5): the
 * server mixes in the due reviews, interleaves, and enforces the tier gates and the day's cap on
 * new material — those answers are binding, so a locked tier shows when it opens rather than
 * being played anyway. When the server cannot be asked (offline, an error, an older server) the
 * device composes from the packed unit, as before. Composition happens once per visit.
 */
export default function LessonRoute() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { sessionId = '' } = useLocalSearchParams<{ sessionId: string }>();
  const parsed = parseSessionId(sessionId);
  const nodeId = parsed?.nodeId ?? null;
  const tier = parsed?.tier ?? null;
  const [handed] = useState(() => (parsed ? undefined : takeOver(sessionId)));
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 30));
  const [openedAt] = useState(() => Date.now());

  const course = useCourse();
  const words = useWords();
  const learnerId = useLearner((s) => s.learnerId);
  const unit = useUnit(nodeId ? unitIdOfNode(nodeId) : undefined);
  const auth = useAuthStatus();
  const online = useOnlineStore(isOnline);

  // Ask the server once per visit, if it can be asked at all, for this device's accessibility profile.
  const [askServer] = useState(
    () => !!parsed && serverHasSessions && auth === 'signedIn' && online,
  );
  const [server, setServer] = useState<NodeSessionResult | null>(null);
  const outline =
    nodeId && course.data ? course.data.unitsById.get(unitIdOfNode(nodeId)) : undefined;
  useEffect(() => {
    if (!askServer || !nodeId || !tier || !outline || server) return;
    const node = outline.nodes.find((n) => n.id === nodeId);
    const minutes = (node ? tierMinutes(outline, node, tier) : 10) + REVIEW_ROOM_MIN;
    const prefs = usePrefs.getState();
    let live = true;
    void requestNodeSession(nodeId, tier, minutes, {
      noAudio: prefs.noAudio,
      noVision: prefs.noVision,
    }).then((r) => {
      if (live) setServer(r);
    });
    return () => {
      live = false;
    };
  }, [askServer, nodeId, tier, outline, server]);

  const plan = server?.kind === 'plan' ? server.plan : null;
  // only the units this app packs: a review from a newer content version is skipped, not an error
  const packed = course.data?.unitsById;
  const planIds = useMemo(
    () => (plan && packed ? planUnitIds(plan, (id) => packed.has(id)) : []),
    [plan, packed],
  );

  // Units needed: the plan's items' (to build it), the node's own (to compose on the device),
  // and a handed-over session's (for feedback). None of these depends on what gets composed.
  const nodeUnitId = nodeId ? unitIdOfNode(nodeId) : null;
  const unitIds = useMemo(() => {
    const ids = new Set<string>(planIds);
    if (nodeUnitId) ids.add(nodeUnitId);
    if (handed) {
      if (handed.unitId) ids.add(handed.unitId);
      for (const s of handed.steps) if (s.kind === 'item') ids.add(s.item.unit);
    }
    return [...ids];
  }, [planIds, nodeUnitId, handed]);
  const units = useQueries({
    queries: unitIds.map((id) => ({
      queryKey: ['content', 'unit', id],
      queryFn: () => content.loadUnit(id),
      staleTime: Infinity,
      gcTime: 30 * 60_000,
    })),
    combine: combineUnits,
  });

  // The server's plan as runner steps, built once every unit it needs has loaded: undefined while
  // waiting, null when the device has none of its items (a newer content version).
  const planReady =
    !!plan && !!packed && !units.pending && planIds.every((id) => units.map.has(id));
  const fromServer = useMemo<ComposedSession | null | undefined>(() => {
    if (!plan || !planReady) return undefined;
    const prefs = usePrefs.getState();
    const built = fromServerPlan(plan, units.map, {
      profile: { noAudio: prefs.noAudio, noVision: prefs.noVision },
    });
    if (!built) log.warn('lesson.server_plan_unusable', { nodeId, tier });
    return built;
  }, [plan, planReady, units.map, nodeId, tier]);
  // counted once per plan the packed content could not play (DECISIONS §23)
  useEffect(() => {
    if (fromServer === null) countEvent('server_plan_unplayable');
  }, [fromServer]);

  // The device composes when the server was not asked, could not answer, could not be used, or
  // has not yet heard of a previous tier this device finished lately (it may still be in the
  // outbox) — and then still keeps tier 3's spacing. A device record older than that is not
  // enough: the server records a tier only when it was passed.
  const fallback =
    server?.kind === 'previous_tier' && nodeId && tier
      ? deviceGate(useLearner.getState().data.completed[nodeId], tier, openedAt)
      : null;
  const deviceHasPrevious = fallback?.kind === 'open';
  const spacedUntil =
    server?.kind === 'spaced'
      ? server.availableAt
      : fallback?.kind === 'spaced'
        ? fallback.availableAt
        : null;
  const useLocal =
    !askServer ||
    server?.kind === 'unavailable' ||
    (server?.kind === 'previous_tier' && deviceHasPrevious) ||
    fromServer === null;

  const local = useMemo<ComposedSession | null>(() => {
    if (handed) return handed;
    if (!useLocal || !nodeId || !tier || !unit.data) return null;
    const prefs = usePrefs.getState();
    try {
      return composeNodeSession(unit.data, nodeId, tier, {
        profile: { noAudio: prefs.noAudio, noVision: prefs.noVision },
        completed: completedMap(useLearner.getState().data),
        seed,
      });
    } catch (e) {
      log.warn('lesson.compose_failed', { nodeId, tier, e });
      return null;
    }
  }, [handed, useLocal, nodeId, tier, unit.data, seed]);

  const session = local ?? fromServer ?? null;

  const error = course.error ?? words.error ?? unit.error ?? units.error;
  if (error) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 20, gap: 16, backgroundColor: theme.c.bg }}>
        <ProblemNotice
          problem={asProblem(error)}
          onRetry={() => {
            void course.refetch();
            void words.refetch();
            void unit.refetch();
            units.refetch();
          }}
        />
        <Button variant="secondary" onPress={leave}>
          {t('lesson.close.backToPath')}
        </Button>
      </SafeAreaView>
    );
  }

  if (spacedUntil && tier) {
    return (
      <Calm
        pose="rest"
        title={t('lesson.gate.spacedTitle', { n: tier })}
        body={t('lesson.gate.spaced', { when: dayAndTime(spacedUntil, i18n.language) })}
        testID="lesson-spaced"
      >
        <Button onPress={() => router.replace('/review')} icon="cards">
          {t('lesson.gate.review')}
        </Button>
        <Button variant="secondary" onPress={leave}>
          {t('lesson.close.backToPath')}
        </Button>
      </Calm>
    );
  }
  if (server?.kind === 'previous_tier' && fallback?.kind === 'previous_tier' && tier) {
    return (
      <Calm
        pose="think"
        title={t('lesson.gate.previousTitle')}
        body={t('lesson.gate.previous', { n: tier - 1 })}
        testID="lesson-previous-tier"
      >
        {nodeId ? (
          <Button
            onPress={() =>
              router.replace({
                pathname: '/lesson/[sessionId]',
                params: { sessionId: sessionIdFor(nodeId, (tier - 1) as Tier) },
              })
            }
          >
            {t('lesson.gate.playPrevious', { n: tier - 1 })}
          </Button>
        ) : null}
        <Button variant="secondary" onPress={leave}>
          {t('lesson.close.backToPath')}
        </Button>
      </Calm>
    );
  }
  if (server?.kind === 'capped') {
    return (
      <Calm
        pose="happy"
        title={t('lesson.gate.cappedTitle')}
        body={t('lesson.gate.capped')}
        testID="lesson-capped"
      >
        <Button onPress={() => router.replace('/review')} icon="cards">
          {t('lesson.gate.review')}
        </Button>
        <Button variant="secondary" onPress={leave}>
          {t('lesson.close.backToPath')}
        </Button>
      </Calm>
    );
  }

  const notFound = (!parsed && !handed) || (parsed && unit.data && useLocal && !local);
  if (notFound) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          padding: 20,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          backgroundColor: theme.c.bg,
        }}
        testID="lesson-not-found"
      >
        <Mascot pose="think" size={120} />
        <Txt variant="title-m" align="center">
          {t('lesson.notFound')}
        </Txt>
        <Button onPress={leave}>{t('lesson.close.backToPath')}</Button>
      </SafeAreaView>
    );
  }

  if (!session || !course.data || !words.data || units.pending || !learnerId) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.c.bg,
        }}
      >
        <View accessibilityLiveRegion="polite" testID="lesson-loading">
          <Txt color="ink-3">{learnerId ? t('common.loading') : t('me.loadingProfile')}</Txt>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <LessonRunner
      key={`${session.id}:${seed}`}
      session={session}
      units={units.map}
      words={words.data}
      course={course.data}
      onLeave={leave}
      onNext={(next: string, nextTier: Tier) =>
        router.replace({
          pathname: '/lesson/[sessionId]',
          params: { sessionId: sessionIdFor(next, nextTier) },
        })
      }
    />
  );
}
