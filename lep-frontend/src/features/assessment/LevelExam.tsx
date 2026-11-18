import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View } from 'react-native';

import { serverOperations } from '@/api/paths.generated';
import { serverHasExam, useCompleteExam, useStartExam } from '@/api/queries/assessment';
import type { CefrBand } from '@/api/queries/gamification';
import type { ExamOut, ExamResultOut } from '@/api/types';
import { sfx } from '@/audio/sfx';
import type { Course } from '@/content/model';
import {
  Button,
  Card,
  Icon,
  LevelBadge,
  Mascot,
  Notice,
  Screen,
  ScreenHeader,
  Txt,
} from '@/design';
import { ProblemNotice, asProblem } from '@/features/errors';
import { formatTime } from '@/features/progress/serverState';
import { log } from '@/lib/log';
import { useLearner } from '@/state/learner';
import { usePrefs } from '@/state/prefs';

import { AssessmentRunner } from './AssessmentRunner';
import { ExamReport } from './ExamReport';
import { flushOutbox } from './flush';
import { useLocatedItems } from './useItems';

/** The papers in the order they are taken (docs/12 §4.1). */
const serverHasExamReport = (serverOperations as readonly string[]).includes(
  'GET /v1/assessment/exams/{exam_id}/report',
);

export const PAPER_ORDER = ['listening', 'reading', 'use_of_english'] as const;

type Phase =
  | { kind: 'intro' }
  | { kind: 'ready'; exam: ExamOut }
  | { kind: 'running'; exam: ExamOut }
  | { kind: 'checking'; exam: ExamOut }
  | { kind: 'offline'; exam: ExamOut }
  | { kind: 'result'; exam: ExamOut; result: ExamResultOut }
  | { kind: 'report'; exam: ExamOut; result: ExamResultOut };

/** Every item of the form, paper by paper. */
export function examItemIds(exam: Pick<ExamOut, 'papers'>): string[] {
  const named = PAPER_ORDER.flatMap((p) => exam.papers[p] ?? []);
  const others = Object.entries(exam.papers)
    .filter(([p]) => !(PAPER_ORDER as readonly string[]).includes(p))
    .flatMap(([, ids]) => ids);
  return [...named, ...others];
}

const pct = (x: number) => Math.round(x * 100);

/**
 * The level exam (docs/12 §4): the server forms it (receptive papers from the level's items,
 * never one the learner met in an exam in the last 12 months) and grades it from the answers it
 * *received* before the exam ended. The device only shows the items and stores each answer in
 * the outbox under the exam's id. Nothing is marked while the exam runs; the result shows each
 * paper's share against the pass marks. The exam is one of the four conditions of a level award,
 * never the award itself.
 */
export function LevelExam({
  level,
  course,
  words,
  onDone,
}: {
  level: CefrBand;
  course: Course;
  words: ReadonlySet<string>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const language = usePrefs((s) => s.interfaceLanguage);
  const learnerId = useLearner((s) => s.learnerId);
  const start = useStartExam();
  const complete = useCompleteExam();
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const exam = phase.kind === 'intro' ? null : phase.exam;
  const ids = useMemo(() => (exam ? examItemIds(exam) : []), [exam]);
  const unitOrder = useMemo(
    () => course.sections.flatMap((s) => s.units.map((u) => u.id)),
    [course],
  );
  const located = useLocatedItems(ids, unitOrder);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const begin = () => {
    start.mutate(level, {
      onSuccess: (e) => setPhase({ kind: 'ready', exam: e }),
      onError: (e) => log.info('exam.start_failed', e),
    });
  };

  const check = useCallback(
    async (e: ExamOut) => {
      if (!learnerId) return;
      setPhase({ kind: 'checking', exam: e });
      const sent = await flushOutbox(learnerId);
      if (!mounted.current) return;
      if (!sent) {
        setPhase({ kind: 'offline', exam: e });
        return;
      }
      complete.mutate(e.id, {
        onSuccess: (result) => {
          if (!mounted.current) return;
          if (result.passed) {
            sfx('levelup');
            AccessibilityInfo.announceForAccessibility(t('exam.passedTitle', { level }));
          }
          setPhase({ kind: 'result', exam: e, result });
        },
        onError: () => mounted.current && setPhase({ kind: 'offline', exam: e }),
      });
    },
    [learnerId, complete, level, t],
  );

  const header = (
    <ScreenHeader title={t('exam.title', { level })} onBack={onDone} backLabel={t('common.back')} />
  );

  if (phase.kind === 'running') {
    if (located.error) {
      return (
        <Screen header={header}>
          <ProblemNotice problem={asProblem(located.error)} onRetry={onDone} />
        </Screen>
      );
    }
    return (
      <AssessmentRunner
        items={located.items}
        units={located.units}
        words={words}
        course={course}
        mode="exam"
        sessionId={phase.exam.id}
        onFinish={() => void check(phase.exam)}
        onLeave={onDone}
      />
    );
  }

  if (phase.kind === 'ready') {
    const { exam: e } = phase;
    const ends = formatTime(e.ends_at, language);
    return (
      <Screen header={header} testID="exam-ready">
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 8 }}>
          <LevelBadge level={level} />
          <Txt variant="display-m" align="center" accessibilityRole="header">
            {t('exam.readyTitle')}
          </Txt>
        </View>
        <Card>
          <Txt variant="body-m" testID="exam-questions">
            {t('exam.questions', { count: ids.length })}
          </Txt>
          <Txt variant="body-m" testID="exam-ends">
            {t('exam.endsAt', { time: ends })}
          </Txt>
          <Txt variant="body-m" testID="exam-pass">
            {t('exam.passMarks', { overall: pct(e.pass_overall), paper: pct(e.pass_paper) })}
          </Txt>
        </Card>
        {located.pending ? (
          <Txt color="ink-3" accessibilityLiveRegion="polite">
            {t('common.loading')}
          </Txt>
        ) : located.missing.length > 0 ? (
          <View testID="exam-missing">
            <Notice icon="warning" tone="orange">
              {t('exam.missing', { count: located.missing.length })}
            </Notice>
          </View>
        ) : null}
        {e.reused ? <Notice icon="info">{t('exam.reused')}</Notice> : null}
        <Button
          block
          onPress={() => setPhase({ kind: 'running', exam: e })}
          disabled={located.pending || located.items.length === 0}
          testID="exam-begin"
        >
          {t('exam.begin')}
        </Button>
      </Screen>
    );
  }

  if (phase.kind === 'checking') {
    return (
      <Screen header={header} testID="exam-checking">
        <View style={{ alignItems: 'center', gap: 16, paddingTop: 24 }}>
          <Mascot pose="think" size={120} />
          <Txt variant="title-m" align="center" accessibilityLiveRegion="polite">
            {t('exam.checking')}
          </Txt>
        </View>
      </Screen>
    );
  }

  if (phase.kind === 'offline') {
    return (
      <Screen header={header} testID="exam-offline">
        <View style={{ alignItems: 'center', gap: 16, paddingTop: 24 }}>
          <Mascot pose="rest" size={120} />
          <Txt variant="title-m" align="center">
            {t('exam.offlineTitle')}
          </Txt>
          <Txt color="ink-2" align="center">
            {t('exam.offlineBody', { time: formatTime(phase.exam.ends_at, language) })}
          </Txt>
        </View>
        <Button
          block
          onPress={() => void check(phase.exam)}
          busy={complete.isPending}
          testID="exam-recheck"
        >
          {t('exam.checkAgain')}
        </Button>
        <Button block variant="secondary" onPress={onDone}>
          {t('exam.later')}
        </Button>
      </Screen>
    );
  }

  if (phase.kind === 'report') {
    const back = () => setPhase({ kind: 'result', exam: phase.exam, result: phase.result });
    return <ExamReport examId={phase.exam.id} onBack={back} />;
  }

  if (phase.kind === 'result') {
    const { result, exam: e } = phase;
    const papers = [
      ...PAPER_ORDER.filter((p) => p in result.scores),
      ...Object.keys(result.scores).filter((p) => !(PAPER_ORDER as readonly string[]).includes(p)),
    ];
    return (
      <Screen header={header} testID={result.passed ? 'exam-passed' : 'exam-not-yet'}>
        <View style={{ alignItems: 'center', gap: 14, paddingTop: 12 }}>
          <Mascot pose={result.passed ? 'cheer' : 'happy'} size={140} />
          <Txt variant="display-m" align="center" accessibilityRole="header">
            {result.passed ? t('exam.passedTitle', { level }) : t('exam.notYetTitle')}
          </Txt>
          <Txt variant="body-l" color="ink-2" align="center" testID="exam-overall">
            {t('exam.overall', { value: pct(result.overall), need: pct(e.pass_overall) })}
          </Txt>
        </View>
        <Card>
          {papers.map((p) => {
            const value = result.scores[p] ?? 0;
            const ok = value >= e.pass_paper;
            const name = t(`exam.paper.${p}`, { defaultValue: p });
            return (
              <View
                key={p}
                style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}
                accessible
                accessibilityLabel={t('exam.paperScoreA11y', {
                  paper: name,
                  value: pct(value),
                  need: pct(e.pass_paper),
                })}
                testID={`exam-paper-${p}`}
              >
                <Icon name={ok ? 'check-circle' : 'target'} size={22} />
                <Txt variant="body-m" weight={800} style={{ flex: 1 }}>
                  {name}
                </Txt>
                <Txt variant="body-m">{`${pct(value)}%`}</Txt>
              </View>
            );
          })}
        </Card>
        <Notice icon="info">
          {result.passed ? t('exam.passedBody', { level }) : t('exam.notYetBody')}
        </Notice>
        {serverHasExamReport ? (
          <Button
            block
            variant="secondary"
            onPress={() => setPhase({ kind: 'report', exam: e, result })}
            testID="exam-report-open"
          >
            {t('examReport.open')}
          </Button>
        ) : null}
        <Button block onPress={onDone} testID="exam-done">
          {t('common.done')}
        </Button>
      </Screen>
    );
  }

  // intro
  return (
    <Screen header={header} testID="exam-intro">
      <View style={{ alignItems: 'center', gap: 12, paddingTop: 8 }}>
        <Mascot pose="wave" size={120} />
        <LevelBadge level={level} />
        <Txt variant="display-m" align="center" accessibilityRole="header">
          {t('exam.introTitle', { level })}
        </Txt>
      </View>
      <Card>
        {(['rulePapers', 'ruleTime', 'ruleNoMarks', 'ruleCondition'] as const).map((k) => (
          <View key={k} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="check-circle" size={22} />
            <Txt style={{ flex: 1 }}>{t(`exam.${k}`, { level })}</Txt>
          </View>
        ))}
      </Card>
      {!serverHasExam ? (
        <Notice icon="info">{t('exam.unavailable')}</Notice>
      ) : start.error ? (
        <ProblemNotice problem={asProblem(start.error)} onRetry={begin} />
      ) : null}
      <Button
        block
        onPress={begin}
        busy={start.isPending}
        disabled={!serverHasExam || !learnerId}
        testID="exam-start"
      >
        {t('exam.start')}
      </Button>
      <Button block variant="ghost" onPress={onDone} testID="exam-not-now">
        {t('exam.notNow')}
      </Button>
    </Screen>
  );
}
