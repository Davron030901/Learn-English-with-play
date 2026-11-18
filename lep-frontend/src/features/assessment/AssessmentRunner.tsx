import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, KeyboardAvoidingView, Modal, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
  Txt,
  levelTone,
  radius,
  useTheme,
} from '@/design';
import { ExerciseView, instructionText } from '@/exercises/ExerciseView';
import type { ExerciseContext } from '@/exercises/types';
import { feedbackContent, type FeedbackContent } from '@/grading/feedback';
import { grade, type GradeResult, type Submission } from '@/grading/grade';
import { log } from '@/lib/log';
import { uuidv7 } from '@/lib/uuid';
import { getOutbox } from '@/outbox';
import type { NewRecord, SubmissionRecord } from '@/outbox/outbox';
import { clampRt } from '@/runner/machine';
import { useLearner } from '@/state/learner';
import { usePrefs } from '@/state/prefs';

import { FeedbackPanel } from '../lesson/FeedbackPanel';
import { gradeContextFor, toSubmissionRecord } from '../lesson/record';

const monotonic = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export interface AssessmentAnswer {
  itemId: string;
  submission: SubmissionRecord;
  /** The device's verdict: shown during a test-out, never sent as the grade (the server grades). */
  verdict: GradeResult['verdict'];
}

export type AssessmentMode = 'testOut' | 'placement' | 'exam' | 'audit';

/** What each assessment is called on its chip and what leaving it means. */
const MODE_COPY: Record<
  AssessmentMode,
  { chip: string; leave: string; icon: 'target' | 'medal' | 'flag' }
> = {
  testOut: { chip: 'assessment.testOutChip', leave: 'assessment.leaveBodyTestOut', icon: 'flag' },
  placement: {
    chip: 'assessment.placementChip',
    leave: 'assessment.leaveBodyPlacement',
    icon: 'target',
  },
  exam: { chip: 'assessment.examChip', leave: 'assessment.leaveBodyExam', icon: 'medal' },
  audit: { chip: 'assessment.auditChip', leave: 'assessment.leaveBodyAudit', icon: 'target' },
};

/**
 * A fixed list of items answered one after another, for the two assessments (docs/16 E14, E20).
 *
 * - **testOut**: each answer is graded on the device for feedback and goes into the outbox like a
 *   lesson answer, with `session_id` = the checkpoint's id, so the server grades the checkpoint
 *   from what it stored and the answers schedule memory as practice (docs/10 §4).
 * - **placement**: no feedback and nothing written — placing is assessing, not practising. The
 *   submissions go back to the caller, which sends the stage to the server to grade.
 * - **exam** (docs/12 §4): every answer goes into the outbox under the exam's id, as a test-out's
 *   does, but no verdict is shown until the end — a verdict mid-exam would teach the next item.
 * - **audit** (docs/08 §9): the monthly memory check, like a test-out — each answer under the
 *   check's id, with feedback (each item checks a different memory item, so none teaches another).
 *
 * No hints and no clocks in either: a test measures what the learner knows at their own pace.
 */
export function AssessmentRunner({
  items,
  units,
  words,
  course,
  mode,
  sessionId,
  offset = 0,
  total,
  onFinish,
  onLeave,
}: {
  items: readonly Item[];
  units: ReadonlyMap<string, Unit>;
  words: ReadonlySet<string>;
  course: Course;
  mode: AssessmentMode;
  sessionId: string;
  /** Items already answered in earlier stages, for the progress bar (placement). */
  offset?: number;
  /** All items the assessment may ask, for the progress bar; defaults to this list. */
  total?: number;
  onFinish: (answers: AssessmentAnswer[]) => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const learnerId = useLearner((s) => s.learnerId);
  const profile = useLearner((s) => s.data.profile);
  const interfaceLanguage = usePrefs((s) => s.interfaceLanguage);
  const noAudio = usePrefs((s) => s.noAudio);
  const noVision = usePrefs((s) => s.noVision);
  const whisper = usePrefs((s) => s.whisper);
  const speed = usePrefs((s) => s.speed);
  const l1 = profile?.l1 ?? CONTENT_L1;
  const accent: Accent = profile?.spellingVariant ?? 'us';

  const [index, setIndex] = useState(0);
  const [plays, setPlays] = useState(0);
  const [shown, setShown] = useState<{
    index: number;
    result: GradeResult;
    content: FeedbackContent;
    clientUuid: string;
  } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [notSaved, setNotSaved] = useState(false);
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 30));
  const [startedMono] = useState(() => monotonic());
  const answers = useRef<AssessmentAnswer[]>([]);
  // Set when each item appears (the effect below runs on mount too).
  const stepStartedAt = useRef(0);
  const submittedFor = useRef(-1);
  const finished = useRef(false);
  const scroll = useRef<ScrollView>(null);

  const item = items[index] ?? null;
  const unit = item ? units.get(item.unit) : undefined;

  useEffect(() => preloadSfx(['correct', 'incorrect', 'tap', 'complete']), []);
  useEffect(
    () => () => {
      void stopAudio();
      discardAllRecordings();
    },
    [],
  );
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
    stepStartedAt.current = Date.now();
    void stopAudio();
  }, [index]);

  const backAction = useRef<() => void>(() => setConfirmLeave(true));
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      backAction.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  const ctx = useMemo<ExerciseContext | null>(
    () =>
      unit
        ? {
            unit,
            cefr: unit.cefr,
            l1,
            english: words,
            profile: { noAudio, noVision },
            accent,
            speed,
            timers: 'off',
            timedMode: false,
            whisper,
            seed: seed + index,
            reduceMotion: theme.reduceMotion,
          }
        : null,
    [unit, l1, words, noAudio, noVision, accent, speed, whisper, seed, index, theme.reduceMotion],
  );

  const enqueue = useCallback(
    (record: NewRecord) => {
      if (!learnerId) {
        log.error('outbox.no_learner', { kind: record.kind });
        return;
      }
      void getOutbox(learnerId)
        .enqueue(record)
        .then((ok) => {
          if (!ok) setNotSaved(true);
        })
        .catch((e: unknown) => {
          log.error('outbox.enqueue_failed', e);
          setNotSaved(true);
        });
    },
    [learnerId],
  );

  const advance = useCallback(() => {
    if (index + 1 < items.length) {
      setIndex(index + 1);
      setPlays(0);
      return;
    }
    if (finished.current) return;
    finished.current = true;
    void stopAudio();
    discardAllRecordings();
    onFinish([...answers.current]);
  }, [index, items.length, onFinish]);

  const latest = useRef({ index, item, unit, l1 });
  useLayoutEffect(() => {
    latest.current = { index, item, unit, l1 };
  });

  const onSubmit = useCallback(
    (sub: Submission) => {
      const { index: i, item: it, unit: u, l1: lang } = latest.current;
      if (!it || submittedFor.current === i) return;
      submittedFor.current = i;
      const now = Date.now();
      let result: GradeResult;
      try {
        result = grade(it, sub, gradeContextFor(it, u, words));
      } catch (e) {
        log.error('assessment.grade_failed', { item: it.id, type: it.type_id, kind: sub.kind, e });
        result = {
          verdict: 'ungraded',
          expected: null,
          typo: null,
          rejected: null,
          reason: 'free_response',
        };
      }
      const record = toSubmissionRecord(it, sub);
      answers.current = [
        ...answers.current,
        { itemId: it.id, submission: record, verdict: result.verdict },
      ];
      if (mode === 'placement') {
        // No verdict is shown while placing: a neutral tap, then the next item.
        sfx('tap');
        advance();
        return;
      }
      const clientUuid = uuidv7(now);
      if (mode === 'exam') {
        // Stored for the server to grade; nothing is shown until the exam is finished.
        sfx('tap');
      } else {
        sfx(
          result.verdict === 'correct'
            ? 'correct'
            : result.verdict === 'incorrect'
              ? 'incorrect'
              : 'pop',
        );
        setShown({
          index: i,
          result,
          content: feedbackContent(it, result, u, lang, words),
          clientUuid,
        });
      }
      enqueue({
        kind: 'review',
        client_uuid: clientUuid,
        created_at: new Date(now).toISOString(),
        monotonic_ms: Math.round(monotonic() - startedMono),
        payload: {
          item_id: it.id,
          session_id: sessionId,
          submission: record,
          rt_ms: clampRt(now - stepStartedAt.current),
          hints_used: 0,
          plays_used: plays,
          started_at: new Date(stepStartedAt.current).toISOString(),
          content_version: contentVersion,
          local_verdict: result.verdict,
          local_typo: result.typo !== null,
        },
      });
      log.info('assessment.answer', { item: it.id, verdict: result.verdict });
      if (mode === 'exam') advance();
    },
    [words, mode, advance, enqueue, startedMono, sessionId, plays],
  );

  const onDispute = useCallback(() => {
    if (!shown || !item) return;
    const now = Date.now();
    enqueue({
      kind: 'dispute',
      client_uuid: uuidv7(now),
      created_at: new Date(now).toISOString(),
      monotonic_ms: Math.round(monotonic() - startedMono),
      payload: { review_client_uuid: shown.clientUuid, item_id: item.id },
    });
  }, [shown, item, enqueue, startedMono]);

  const leave = () => {
    if (finished.current) return;
    finished.current = true;
    setConfirmLeave(false);
    void stopAudio();
    discardAllRecordings();
    onLeave();
  };
  useLayoutEffect(() => {
    backAction.current = () => setConfirmLeave(true);
  });

  const current = shown && shown.index === index ? shown : null;
  const all = total ?? items.length;
  const done = offset + index + (current ? 1 : 0);
  const cefr = unit?.cefr ?? 'A1.1';

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: theme.c.bg }}
      testID={`assessment-${mode}`}
    >
      <View style={{ width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' }}>
        <LessonHeader
          progress={all > 0 ? done / all : 0}
          onClose={() => setConfirmLeave(true)}
          closeLabel={t('assessment.leave')}
          tone={mode === 'placement' ? 'purple' : levelTone(cefr)}
          progressLabel={t('assessment.progress', {
            n: Math.min(offset + index + 1, all),
            total: all,
          })}
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
              gap: 14,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Txt variant="overline" color="ink-3" style={{ flex: 1 }} testID="assessment-count">
                {t('assessment.count', { n: Math.min(offset + index + 1, all), total: all })}
              </Txt>
              <Chip
                size="sm"
                icon={MODE_COPY[mode].icon}
                tone={mode === 'placement' ? 'purple' : 'blue'}
              >
                {t(MODE_COPY[mode].chip)}
              </Chip>
            </View>
            {item && ctx ? (
              <ExerciseView
                key={index}
                item={item}
                ctx={ctx}
                result={current?.result ?? null}
                plays={plays}
                onPlay={() => setPlays((p) => p + 1)}
                hint={null}
                onSubmit={onSubmit}
                instruction={instructionText(
                  course.instructions,
                  item.instruction_key,
                  interfaceLanguage,
                )}
              />
            ) : (
              <Txt color="ink-3">{t('common.loading')}</Txt>
            )}
            {notSaved ? (
              <Txt variant="body-s" color="red-ink">
                {t('assessment.notSaved')}
              </Txt>
            ) : null}
          </View>
        </ScrollView>
        {current && item && unit ? (
          <View style={{ width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' }}>
            <FeedbackPanel
              key={index}
              item={item}
              unit={unit}
              result={current.result}
              content={current.content}
              l1={l1}
              onContinue={advance}
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
              testID="assessment-leave-dialog"
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
                {t('assessment.leaveTitle')}
              </Txt>
              <Txt variant="body-m" color="ink-2">
                {t(MODE_COPY[mode].leave)}
              </Txt>
              <Button
                block
                variant="secondary"
                onPress={() => setConfirmLeave(false)}
                testID="assessment-stay"
              >
                {t('assessment.stay')}
              </Button>
              <Button block variant="ghost" onPress={leave} testID="assessment-leave">
                {t('assessment.leaveYes')}
              </Button>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}
