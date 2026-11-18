import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, KeyboardAvoidingView, Modal, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { timerSeconds } from '@/audio/policy';
import { preloadSfx, sfx } from '@/audio/sfx';
import { stopAudio, type Accent } from '@/audio/speech';
import { discardAllRecordings } from '@/audio/useRecorder';
import { CONTENT_L1 } from '@/content/l1';
import type { Course, Unit } from '@/content/model';
import type { Item } from '@/content/schemas';
import { contentVersion } from '@/content/version.generated';
import {
  Button,
  CONTENT_MAX,
  Chip,
  LessonHeader,
  Mascot,
  Notice,
  TextLink,
  Txt,
  levelTone,
  radius,
  useTheme,
  type MascotPose,
} from '@/design';
import { ExerciseView, instructionText } from '@/exercises/ExerciseView';
import { speakMode, type SpeakItem } from '@/exercises/families/Speak';
import type { ExerciseContext } from '@/exercises/types';
import { useSessionAwards } from '@/features/hud/sessionAwards';
import { unitIdOfNode } from '@/features/path/position';
import { FAMILY, grade, type GradeResult, type Submission } from '@/grading/grade';
import { feedbackContent, type FeedbackContent } from '@/grading/feedback';
import { deriveHint } from '@/grading/hints';
import { log } from '@/lib/log';
import { completeServerSession } from '@/api/queries/sessions';
import { uuidv7 } from '@/lib/uuid';
import { getOutbox } from '@/outbox';
import type { NewRecord } from '@/outbox/outbox';
import type { ComposedSession } from '@/runner/compose';
import { clampRt, currentStep, initialState, progress, reducer } from '@/runner/machine';
import { completedMap, useLearner } from '@/state/learner';
import { usePrefs } from '@/state/prefs';
import { countEvent } from '@/state/clientEvents';

import { FeedbackPanel } from './FeedbackPanel';
import { BreakView, CloseView } from './Interstitials';
import { PresentCard } from './PresentCard';
import { LessonPip, RunChip } from './RunChip';
import {
  gradeContextFor,
  hintMessage,
  nextAfter,
  toSubmissionRecord,
  withCompleted,
} from './record';
import { useCountdown } from './useCountdown';

const monotonic = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const GAMES = new Set(['memory_match', 'word_race']);

/** Right answers in a row that earn the combo chime instead of the plain one (never every tap). */
export const COMBO_EVERY = 5;

/**
 * The visible clock for an item, or null. Speaking items use their limit as the recording's
 * maximum (the recorder owns it); a game played through the screen-reader list loses its clock
 * (brief §12: the visual race has no non-visual equivalent); everything else follows
 * DECISIONS F15 via `timerSeconds`.
 */
function countdownFor(
  item: Item,
  unit: Unit,
  prefs: { timers: 'default' | 'double' | 'off'; timedMode: boolean; noVision: boolean },
): number | null {
  if (FAMILY[item.type_id] === 'speak') return null;
  if (prefs.noVision && GAMES.has(item.type_id)) return null;
  return timerSeconds(item, unit.cefr, prefs);
}

interface Answered {
  index: number;
  itemId: string;
  clientUuid: string;
  result: GradeResult;
  content: FeedbackContent;
}

/**
 * One lesson session, from the first step to CLOSE (brief §6). The state machine is
 * runner/machine.ts; this component renders it and does the side effects the reducer must not:
 * grading, the outbox, audio, and leaving.
 *
 * Every answer becomes an outbox row the moment it is submitted — before anything tries to send
 * it (brief §11). Nothing here computes a level, mastery, streak or XP.
 */
export function LessonRunner({
  session,
  units,
  words,
  course,
  onLeave,
  onNext,
}: {
  session: ComposedSession;
  units: ReadonlyMap<string, Unit>;
  words: ReadonlySet<string>;
  course: Course;
  onLeave: () => void;
  onNext: (nodeId: string, tier: 1 | 2 | 3) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const learnerId = useLearner((s) => s.learnerId);
  const learnerData = useLearner((s) => s.data);
  const markCompleted = useLearner((s) => s.markCompleted);
  const interfaceLanguage = usePrefs((s) => s.interfaceLanguage);
  const noAudio = usePrefs((s) => s.noAudio);
  const noVision = usePrefs((s) => s.noVision);
  const timers = usePrefs((s) => s.timers);
  const timedMode = usePrefs((s) => s.timedMode);
  const whisper = usePrefs((s) => s.whisper);
  const speed = usePrefs((s) => s.speed);

  const l1 = learnerData.profile?.l1 ?? CONTENT_L1;
  const accent: Accent = learnerData.profile?.spellingVariant ?? 'us';

  // The server's recovery items (if it composed the session) wait in the state for a wrong last answer.
  const [state, dispatch] = useReducer(reducer, session, (s) =>
    initialState(s.steps, Date.now(), { recovery: s.recovery }),
  );
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [outboxFull, setOutboxFull] = useState(false);
  // Fixed for the life of the session (lazy initialisers run once).
  // A server-composed session's own id, so the server can tie the answers to its plan.
  const [runId] = useState(() => session.serverId ?? uuidv7());
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 30));
  const [startedMono] = useState(() => monotonic());
  const scroll = useRef<ScrollView>(null);

  const step = currentStep(state);
  const item = step?.kind === 'item' ? step.item : null;
  const sessionUnit = units.get(session.unitId);
  const itemUnit = item ? (units.get(item.unit) ?? sessionUnit) : sessionUnit;
  const current = answered && answered.index === state.index ? answered : null;
  const hint = useMemo(() => (item ? deriveHint(item) : null), [item]);

  const ctx = useMemo<ExerciseContext | null>(
    () =>
      itemUnit
        ? {
            unit: itemUnit,
            cefr: itemUnit.cefr,
            l1,
            english: words,
            profile: { noAudio, noVision },
            accent,
            speed,
            timers,
            timedMode,
            whisper,
            seed: seed + state.index,
            reduceMotion: theme.reduceMotion,
          }
        : null,
    [
      itemUnit,
      l1,
      words,
      noAudio,
      noVision,
      accent,
      speed,
      timers,
      timedMode,
      whisper,
      seed,
      state.index,
      theme.reduceMotion,
    ],
  );

  // ---------------------------------------------------------------- feedback sounds
  useEffect(
    () =>
      preloadSfx(['correct', 'incorrect', 'combo', 'complete', 'ring', 'streak', 'quest', 'stamp']),
    [],
  );
  const streakInRow = useRef(0);
  /** The run milestone (5, 10, 15…) reached on the answer at `index`, for the run chip and Pip. */
  const [runAt, setRunAt] = useState<{ index: number; count: number } | null>(null);
  // Awards the server sends back while the lesson is open (answers sync in small batches).
  const sessionAwards = useSessionAwards();

  // ---------------------------------------------------------------- side effects of leaving
  useEffect(
    () => () => {
      void stopAudio();
      discardAllRecordings();
    },
    [],
  );

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
    void stopAudio();
  }, [state.index]);

  const backAction = useRef<() => void>(() => setConfirmLeave(true));
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      backAction.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  const outboxRecord = useCallback(
    (record: NewRecord) => {
      if (!learnerId) {
        // The route does not start a lesson without a learner id; this is a bug if it happens.
        log.error('outbox.no_learner', { kind: record.kind });
        return;
      }
      void getOutbox(learnerId)
        .enqueue(record)
        .then((ok) => {
          if (ok) return;
          setOutboxFull(true);
          countEvent('outbox_full');
        })
        .catch((e: unknown) => {
          // Treated like a full outbox: the learner is told this answer was not kept.
          log.error('outbox.enqueue_failed', e);
          setOutboxFull(true);
        });
    },
    [learnerId],
  );

  // ---------------------------------------------------------------- answering
  // The latest render's values for the stable callback below. A layout effect runs before any
  // child's passive effect, so a renderer that submits from an effect never sees a stale step.
  const latest = useRef({ state, item, itemUnit, l1 });
  useLayoutEffect(() => {
    latest.current = { state, item, itemUnit, l1 };
  });
  const submittedFor = useRef(-1);

  /** Stable across renders: renderers may call it from effects (a recording's time limit). */
  const onSubmit = useCallback(
    (sub: Submission) => {
      const { state: s, item: it, itemUnit: u, l1: lang } = latest.current;
      if (s.status !== 'answering' || !it || submittedFor.current === s.index) return;
      submittedFor.current = s.index;
      const now = Date.now();
      let result: GradeResult;
      try {
        result = grade(it, sub, gradeContextFor(it, u, words));
      } catch (e) {
        // A renderer handed the grader the wrong shape: a bug, never the learner's fault.
        log.error('lesson.grade_failed', { item: it.id, type: it.type_id, kind: sub.kind, e });
        result = {
          verdict: 'ungraded',
          expected: null,
          typo: null,
          rejected: null,
          reason: 'free_response',
        };
      }
      const content = feedbackContent(it, result, u, lang, words);
      // The run (docs/16 E05): a correct answer without a hint adds one; with a hint it keeps
      // the run without adding; a wrong answer or a timeout ends it; ungraded leaves it alone.
      if (result.verdict === 'correct') {
        if (s.hints === 0) streakInRow.current += 1;
        const milestone = s.hints === 0 && streakInRow.current % COMBO_EVERY === 0;
        if (milestone) setRunAt({ index: s.index, count: streakInRow.current });
        sfx(milestone ? 'combo' : 'correct');
      } else if (result.verdict === 'incorrect') {
        streakInRow.current = 0;
        sfx('incorrect');
      } else {
        sfx('pop');
      }
      const clientUuid = uuidv7(now);
      setAnswered({ index: s.index, itemId: it.id, clientUuid, result, content });
      dispatch({ type: 'submitted', now, submission: sub, result, clientUuid });
      outboxRecord({
        kind: 'review',
        client_uuid: clientUuid,
        created_at: new Date(now).toISOString(),
        monotonic_ms: Math.round(monotonic() - startedMono),
        payload: {
          item_id: it.id,
          session_id: runId,
          submission: toSubmissionRecord(it, sub),
          rt_ms: clampRt(now - s.stepStartedAt),
          hints_used: s.hints,
          plays_used: s.plays,
          started_at: new Date(s.stepStartedAt).toISOString(),
          content_version: contentVersion,
          local_verdict: result.verdict,
          local_typo: result.typo !== null,
        },
      });
      // Item and verdict only: never the answer text (brief §0, §9 — the account may be a minor's).
      log.info('lesson.answer', { item: it.id, verdict: result.verdict });
    },
    [words, outboxRecord, runId, startedMono],
  );

  const onDispute = useCallback(() => {
    if (!current) return;
    const now = Date.now();
    outboxRecord({
      kind: 'dispute',
      client_uuid: uuidv7(now),
      created_at: new Date(now).toISOString(),
      monotonic_ms: Math.round(monotonic() - startedMono),
      payload: { review_client_uuid: current.clientUuid, item_id: current.itemId },
    });
  }, [current, outboxRecord, startedMono]);

  // What a timed game has done so far, so expiry submits it instead of a bare timeout.
  const partial = useRef<(() => Submission | null) | null>(null);
  const onPartial = useCallback((provider: (() => Submission | null) | null) => {
    partial.current = provider;
  }, []);
  const onTimeout = useCallback(
    () => onSubmit(partial.current?.() ?? { kind: 'timeout' }),
    [onSubmit],
  );

  const onPlay = useCallback(() => dispatch({ type: 'played' }), []);
  const onBreakDone = useCallback(() => dispatch({ type: 'break_done', now: Date.now() }), []);

  const seconds =
    item && itemUnit ? countdownFor(item, itemUnit, { timers, timedMode, noVision }) : null;
  // The clock stops while the leave dialog is open: thinking about leaving must not cost an Again.
  const left = useCountdown(
    seconds,
    state.status === 'answering' && !confirmLeave,
    onTimeout,
    state.index,
  );

  // ---------------------------------------------------------------- close
  const completed = useMemo(() => completedMap(learnerData), [learnerData]);
  const next = useMemo(
    () =>
      session.nodeId
        ? nextAfter(
            course,
            session.nodeId,
            session.tier,
            withCompleted(completed, session.nodeId, session.tier),
          )
        : null,
    [course, session.nodeId, session.tier, completed],
  );

  const finished = useRef(false);
  const finish = (then: 'stop' | 'next') => {
    // A second tap on the close screen must not navigate twice.
    if (finished.current) return;
    finished.current = true;
    const reachedClose = state.status === 'close';
    dispatch({ type: 'finish', now: Date.now() });
    // A node-tier counts as finished on this device only when the session reached CLOSE having
    // practised something (a tier the device could present nothing of is not "finished").
    if (session.nodeId && reachedClose && state.answers.length > 0)
      markCompleted(session.nodeId, session.tier);
    if (session.serverId && reachedClose) completeServerSession(session.serverId);
    void stopAudio();
    discardAllRecordings();
    if (then === 'next' && next && reachedClose) onNext(next.nodeId, next.tier);
    else onLeave();
  };

  const leave = () => {
    if (finished.current) return;
    finished.current = true;
    setConfirmLeave(false);
    dispatch({ type: 'quit', now: Date.now() });
    void stopAudio();
    discardAllRecordings();
    onLeave();
  };

  useLayoutEffect(() => {
    backAction.current =
      state.status === 'close' ? () => finish('stop') : () => setConfirmLeave(true);
  });

  const practisedCount = state.answers.length;
  const reachedClose = step?.kind === 'close';
  useEffect(() => {
    if (reachedClose && practisedCount > 0) sfx('complete');
  }, [reachedClose, practisedCount]);
  const hasContent = session.steps.some((s) => s.kind === 'item' || s.kind === 'present');
  const withheldRecordings = session.withheld.filter((w) => w.reason === 'notation_audio').length;
  const withheldByProfile = session.withheld.filter((w) => w.reason === 'profile').length;

  const closeSession = useMemo(
    () => ({
      runId,
      learnerId,
      startedAt: state.startedAt,
      awards: sessionAwards.awards,
      before: sessionAwards.before,
      nodeTitle: (nodeId: string) =>
        course.unitsById.get(unitIdOfNode(nodeId))?.nodes.find((n) => n.id === nodeId)?.title ??
        null,
      unitNumber: (unitId: string) => course.unitsById.get(unitId)?.index ?? null,
    }),
    [runId, learnerId, state.startedAt, sessionAwards.awards, sessionAwards.before, course],
  );

  // ---------------------------------------------------------------- body
  let body: React.ReactNode = null;
  if (!hasContent) {
    body = (
      <View style={{ gap: 16, alignItems: 'center', paddingTop: 32 }} testID="lesson-empty">
        <Mascot pose="think" size={120} />
        <Txt variant="title-m" align="center">
          {t('lesson.noItems')}
        </Txt>
        {withheldRecordings > 0 ? (
          <Notice icon="info">{t('lesson.withheld', { count: withheldRecordings })}</Notice>
        ) : null}
        {withheldByProfile > 0 ? (
          <Notice icon="info">{t('lesson.withheldProfile', { count: withheldByProfile })}</Notice>
        ) : null}
        <Button onPress={onLeave}>{t('lesson.close.backToPath')}</Button>
      </View>
    );
  } else if (step?.kind === 'present' && sessionUnit) {
    body = (
      <PresentCard
        key={state.index}
        card={step.card}
        unit={sessionUnit}
        l1={l1}
        accent={accent}
        onGotIt={() => dispatch({ type: 'got_it', now: Date.now() })}
      />
    );
  } else if (step?.kind === 'break') {
    body = <BreakView onDone={onBreakDone} />;
  } else if (step?.kind === 'close') {
    body = (
      <CloseView
        practised={practisedCount}
        introduced={session.introduced}
        nextTitle={
          next
            ? `${t('common.unit', { n: next.unitIndex })} · ${next.title} · ${t('path.tier', { n: next.tier })}`
            : null
        }
        withheld={withheldRecordings}
        withheldByProfile={withheldByProfile}
        notSaved={outboxFull}
        onStop={() => finish('stop')}
        onNext={next ? () => finish('next') : null}
        session={closeSession}
      />
    );
  } else if (step?.kind === 'item' && item && ctx) {
    const game = GAMES.has(item.type_id);
    const hm = hint ? hintMessage(hint) : null;
    body = (
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Txt variant="overline" color="ink-3" style={{ flex: 1 }} testID="phase">
            {t(`lesson.phase.${step.phase}`)}
          </Txt>
          {left !== null && state.status === 'answering' ? (
            <View accessibilityLabel={t('lesson.timer', { seconds: left })} testID="timer">
              <Chip size="sm" icon="clock" tone={left <= 5 ? 'orange' : 'blue'}>
                {String(left)}
              </Chip>
            </View>
          ) : game && seconds === null ? (
            <Chip size="sm" icon="clock">
              {t('lesson.untimed')}
            </Chip>
          ) : null}
        </View>
        <ExerciseView
          key={state.index}
          item={item}
          ctx={ctx}
          result={current?.result ?? null}
          plays={state.plays}
          onPlay={onPlay}
          hint={state.hints > 0 ? hint : null}
          onSubmit={onSubmit}
          onPartial={onPartial}
          instruction={instructionText(
            course.instructions,
            item.instruction_key,
            interfaceLanguage,
          )}
        />
        {hm && state.status === 'answering' ? (
          state.hints > 0 ? (
            <Notice icon="bulb" tone="yellow">
              {t(hm.key, hm.values)}
            </Notice>
          ) : (
            <View style={{ alignSelf: 'flex-start' }}>
              <TextLink icon="bulb" onPress={() => dispatch({ type: 'hint_used' })} testID="hint">
                {t('lesson.hint')}
              </TextLink>
            </View>
          )
        ) : null}
        {outboxFull ? (
          <Notice icon="warning" tone="orange">
            {t('lesson.outboxFull')}
          </Notice>
        ) : null}
      </View>
    );
  }

  const mode = item && FAMILY[item.type_id] === 'speak' ? speakMode(item as SpeakItem) : undefined;

  // The run chip shows only in the feedback state of the answer that reached the milestone.
  const runMilestone = state.status === 'feedback' && runAt?.index === state.index ? runAt : null;
  // Mini Pip (docs/16 E05 §4): listen on speaking items, happy after a right answer, think after a
  // wrong one (never sad), cheer on a run, rest on a break.
  let pipPose: MascotPose = 'happy';
  if (step?.kind === 'break') pipPose = 'rest';
  else if (state.status === 'feedback' && current)
    pipPose = runMilestone ? 'cheer' : current.result.verdict === 'incorrect' ? 'think' : 'happy';
  else if (item && FAMILY[item.type_id] === 'speak') pipPose = 'listen';

  const cefr = itemUnit?.cefr ?? sessionUnit?.cefr ?? 'A1.1';

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: theme.c.bg }}
      testID="lesson"
    >
      <View style={{ width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center', zIndex: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <LessonHeader
              progress={progress(state)}
              onClose={() =>
                state.status === 'close'
                  ? finish('stop')
                  : !hasContent
                    ? onLeave()
                    : setConfirmLeave(true)
              }
              closeLabel={t('lesson.leave')}
              mode={mode}
              tone={levelTone(cefr)}
              progressLabel={t('lesson.progress')}
            />
          </View>
          {step?.kind === 'close' ? null : (
            <LessonPip
              pose={pipPose}
              bobKey={current?.result.verdict === 'correct' ? state.index : -1}
            />
          )}
        </View>
        <RunChip
          key={runMilestone ? `run-${runMilestone.index}` : 'run'}
          count={runMilestone?.count ?? 0}
          show={!!runMilestone}
        />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={{
              width: '100%',
              maxWidth: CONTENT_MAX,
              alignSelf: 'center',
              paddingHorizontal: 20,
            }}
          >
            {body}
          </View>
        </ScrollView>
        {state.status === 'feedback' && current && item && itemUnit ? (
          <View style={{ width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' }}>
            <FeedbackPanel
              key={state.index}
              item={item}
              unit={itemUnit}
              result={current.result}
              content={current.content}
              l1={l1}
              onContinue={() => dispatch({ type: 'continue', now: Date.now() })}
              onDispute={onDispute}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
      {confirmLeave ? (
        <Modal
          transparent
          visible
          animationType={theme.reduceMotion ? 'none' : 'fade'}
          onRequestClose={() => setConfirmLeave(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: theme.c.scrim,
              justifyContent: 'center',
              padding: 20,
            }}
          >
            <View
              accessibilityViewIsModal
              testID="leave-dialog"
              style={{
                width: '100%',
                maxWidth: 440,
                alignSelf: 'center',
                backgroundColor: theme.c.surface,
                borderRadius: radius.xl,
                padding: 22,
                gap: 14,
              }}
            >
              <Txt variant="title-l" accessibilityRole="header">
                {t('lesson.leaveTitle')}
              </Txt>
              <Txt variant="body-m" color="ink-2">
                {t('lesson.leaveBody')}
              </Txt>
              <Button block onPress={leave} testID="leave-yes">
                {t('lesson.leaveYes')}
              </Button>
              <Button
                block
                variant="secondary"
                onPress={() => setConfirmLeave(false)}
                testID="leave-no"
              >
                {t('lesson.leaveNo')}
              </Button>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}
