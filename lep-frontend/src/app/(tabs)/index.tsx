import { useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { serverHasAssessment, useShop } from '@/api/queries/assessment';
import { serverHasGamification, useGamificationSummary, useProgress } from '@/api/queries/gamification';
import { useAuthStatus } from '@/api/queries/me';
import type { Course, UnitOutline } from '@/content/model';
import { content, useCourse } from '@/content/queries';
import { Button, CONTENT_MAX, Txt, useTheme } from '@/design';
import { CelebrationHost } from '@/features/celebrate/CelebrationHost';
import { ProblemNotice, asProblem } from '@/features/errors';
import { HudBar } from '@/features/hud/HudBar';
import { StreakSheet, TodaySheet } from '@/features/hud/HudSheets';
import { ResetNotice } from '@/features/hud/ResetNotice';
import { mergeTiers, serverPathOf, unitAllDone } from '@/features/path/merge';
import { NodeSheet } from '@/features/path/NodeSheet';
import { PlaceBand } from '@/features/path/PlaceBand';
import { currentPosition } from '@/features/path/position';
import { UnitRow } from '@/features/path/UnitRow';
import { QuestsCard } from '@/features/quests/QuestsCard';
import { sessionIdFor } from '@/runner/compose';
import { completedMap, useLearner } from '@/state/learner';
import { isOnline, useOnlineStore } from '@/state/online';

type Row = { kind: 'section'; key: string; n: number; cefr: string } | { kind: 'unit'; key: string; unit: UnitOutline };

function rowsOf(course: Course): Row[] {
  const rows: Row[] = [];
  course.sections.forEach((s, i) => {
    rows.push({ kind: 'section', key: s.id, n: i + 1, cefr: s.cefr });
    for (const u of s.units) rows.push({ kind: 'unit', key: u.id, unit: u });
  });
  return rows;
}

const openNotes = (unitId: string) => router.push({ pathname: '/unit/[unitId]', params: { unitId } });
const openTestOut = (unitId: string) => router.push({ pathname: '/test-out/[unitId]', params: { unitId } });

/**
 * The path, the home screen (docs/16 E08): the HUD on top (streak, gems, Pip in the goal ring —
 * every number from the server's summary, docs/16 E00), Continue, today's quests, then 10 place
 * bands and 168 units of eight nodes, rendered from the packed content first so no network is
 * needed. Ticks merge the account's progress with tiers still waiting on this device; nothing is
 * locked until the server decides locks (DECISIONS F22). Unfinished units carry the free test-out
 * key (E14). Rare celebrations open here while the path is on screen (E12).
 */
export default function PathScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const course = useCourse();
  const data = useLearner((s) => s.data);
  const status = useAuthStatus();
  const online = useOnlineStore(isOnline);
  const focused = useIsFocused();

  const summaryQuery = useGamificationSummary();
  const summary = summaryQuery.data ?? null;
  // An older snapshot while the server cannot be reached: the sheets say "as of 14:05".
  const stale = !!summary && (!online || summaryQuery.isError);
  const progress = useProgress();
  const shop = useShop();
  const skin = shop.data?.items.find((i) => i.kind === 'path_skin' && i.equipped)?.id ?? null;

  const server = useMemo(() => serverPathOf(progress.data), [progress.data]);
  const completed = useMemo(() => {
    const device = completedMap(data);
    return course.data ? mergeTiers(course.data, device, server) : device;
  }, [course.data, data, server]);
  const position = useMemo(
    () => (course.data ? currentPosition(course.data, completed, data.startSection, server ? { fromUnit: server.currentUnit, doneUnits: server.doneUnits } : undefined) : null),
    [course.data, completed, data.startSection, server],
  );
  const rows = useMemo(() => (course.data ? rowsOf(course.data) : []), [course.data]);
  const [sheet, setSheet] = useState<{ unit: UnitOutline; nodeId: string } | null>(null);
  const [hud, setHud] = useState<'streak' | 'today' | null>(null);
  const list = useRef<FlatList<Row>>(null);
  const scrolled = useRef(false);

  // Warm the current and next unit (and the word list the grader needs) while online, so the
  // next lessons open without the network — on the web a unit is otherwise fetched on demand.
  const queryClient = useQueryClient();
  const currentUnitId = position?.unit.id ?? (server?.currentUnit && course.data?.unitsById.has(server.currentUnit) ? server.currentUnit : null);
  useEffect(() => {
    if (!currentUnitId || !course.data) return;
    const ids = course.data.sections.flatMap((s) => s.units.map((u) => u.id));
    const at = ids.indexOf(currentUnitId);
    for (const id of [ids[at], ids[at + 1]]) {
      if (id) void queryClient.prefetchQuery({ queryKey: ['content', 'unit', id], queryFn: () => content.loadUnit(id), staleTime: Infinity, gcTime: 30 * 60_000 });
    }
    void queryClient.prefetchQuery({ queryKey: ['content', 'words'], queryFn: () => content.loadWords(), staleTime: Infinity, gcTime: 30 * 60_000 });
  }, [currentUnitId, course.data, queryClient]);

  const currentIndex = currentUnitId ? rows.findIndex((r) => r.kind === 'unit' && r.unit.id === currentUnitId) : -1;
  useEffect(() => {
    if (scrolled.current || currentIndex < 0) return;
    scrolled.current = true;
    const id = setTimeout(() => list.current?.scrollToIndex({ index: Math.max(0, currentIndex - 1), animated: false }), 50);
    return () => clearTimeout(id);
  }, [currentIndex]);

  const onNode = useCallback((unit: UnitOutline, nodeId: string) => setSheet({ unit, nodeId }), []);
  const serverBacked = !!server;
  const started = position?.started ?? false;
  const positionNode = position?.nodeId ?? null;
  const positionUnit = position?.unit.id ?? null;

  const renderItem = useCallback<ListRenderItem<Row>>(
    ({ item: row }) => {
      if (row.kind === 'section') {
        return (
          <View style={{ width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 28, paddingBottom: 8 }}>
            <PlaceBand n={row.n} cefr={row.cefr} skin={skin} testID={`band-${row.key}`} />
          </View>
        );
      }
      const u = row.unit;
      const isDone = !!server?.doneUnits.has(u.id) || unitAllDone(u, completed);
      return (
        <UnitRow
          unit={u}
          completed={completed}
          currentNodeId={positionUnit === u.id ? positionNode : null}
          started={started}
          isCurrent={currentUnitId === u.id}
          isDone={isDone}
          canTestOut={serverHasAssessment}
          serverBacked={serverBacked}
          onNode={onNode}
          onNotes={openNotes}
          onTestOut={openTestOut}
        />
      );
    },
    [skin, server, completed, positionUnit, positionNode, started, currentUnitId, serverBacked, onNode],
  );

  if (course.isError) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 20, backgroundColor: theme.c.bg }}>
        <ProblemNotice problem={asProblem(course.error)} onRetry={() => void course.refetch()} />
      </SafeAreaView>
    );
  }
  if (!course.data) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.c.bg }}>
        <Txt color="ink-3">{t('common.loading')}</Txt>
      </SafeAreaView>
    );
  }

  const sheetUnit = sheet?.unit;
  const sheetNode = sheetUnit?.nodes.find((n) => n.id === sheet?.nodeId);
  const showQuests = serverHasGamification && status === 'signedIn';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.c['bg-soft'] }} testID="path">
      <View style={{ width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' }}>
        <HudBar title={t('path.title')} level={position?.unit.cefr ?? null} summary={summary} onStreak={() => setHud('streak')} onGoal={() => setHud('today')} />
      </View>
      <View style={{ width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 10, gap: 10 }}>
        <ResetNotice message={summary?.streak.reset_message ?? null} />
        {position ? (
          <Button
            size="lg"
            block
            icon="play"
            testID="continue"
            onPress={() => router.push({ pathname: '/lesson/[sessionId]', params: { sessionId: sessionIdFor(position.nodeId, position.tier) } })}
          >
            {`${position.started ? t('path.continue') : t('path.start')} · ${position.unit.nodes.find((n) => n.id === position.nodeId)?.title ?? ''}`}
          </Button>
        ) : null}
        {showQuests ? <QuestsCard daily={summary?.daily_quests ?? []} weekly={summary?.weekly_quests ?? []} available={!!summary} /> : null}
      </View>
      <FlatList
        ref={list}
        data={rows}
        extraData={renderItem}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={5}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: false }), 200);
        }}
        contentContainerStyle={{ paddingBottom: 48 }}
        ListFooterComponent={
          <Txt variant="caption" color="ink-3" align="center" style={{ padding: 16 }}>
            {serverBacked ? t('hud.path.note') : t('path.progressNote')}
          </Txt>
        }
      />
      {sheetUnit && sheetNode ? (
        <NodeSheet
          unit={sheetUnit}
          node={sheetNode}
          done={completed.get(sheetNode.id) ?? []}
          doneLabel={serverBacked ? t('hud.path.tierDone') : undefined}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {hud === 'streak' ? <StreakSheet summary={summary} stale={stale} onClose={() => setHud(null)} /> : null}
      {hud === 'today' ? <TodaySheet summary={summary} stale={stale} onClose={() => setHud(null)} /> : null}
      <CelebrationHost active={focused && !sheet && !hud} includeUnseen />
    </SafeAreaView>
  );
}
