import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { serverHasAudit, useCompleteAudit, useStartAudit } from '@/api/queries/assessment';
import { ApiError } from '@/api/problem';
import type { RetentionAuditOut } from '@/api/types';
import { sfx } from '@/audio/sfx';
import type { Course } from '@/content/model';
import { Button, Card, Icon, Mascot, Notice, Screen, ScreenHeader, Txt } from '@/design';
import { ProblemNotice, asProblem } from '@/features/errors';
import { log } from '@/lib/log';
import { useLearner } from '@/state/learner';

import { AssessmentRunner } from './AssessmentRunner';
import { flushOutbox } from './flush';
import { useLocatedItems } from './useItems';

type Phase =
  | { kind: 'intro' }
  | { kind: 'running'; audit: RetentionAuditOut }
  | { kind: 'checking'; audit: RetentionAuditOut }
  | { kind: 'offline'; audit: RetentionAuditOut }
  | { kind: 'refused'; error: ApiError }
  | { kind: 'result'; audit: RetentionAuditOut };

const pct = (x: number) => Math.round(x * 100);

/**
 * The monthly memory check (docs/08 §9): about 20 things the memory model says are well known,
 * answered cold, within a day. The server compares what was remembered with what it predicted;
 * when memory is materially weaker than predicted, it asks for reviews a little more often (the
 * desired retention steps up) — so the coverage figure stops being an estimate, and the schedule
 * learns from the learner rather than the other way round. The answers count as reviews.
 */
export function RetentionCheck({
  course,
  words,
  onDone,
}: {
  course: Course;
  words: ReadonlySet<string>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const learnerId = useLearner((s) => s.learnerId);
  const start = useStartAudit();
  const complete = useCompleteAudit();
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const audit = phase.kind === 'intro' || phase.kind === 'refused' ? null : phase.audit;
  const ids = useMemo(() => audit?.item_ids ?? [], [audit]);
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
    start.mutate(undefined, {
      onSuccess: (a) => setPhase({ kind: 'running', audit: a }),
      onError: (e) => log.info('audit.start_failed', e),
    });
  };

  const check = useCallback(
    async (a: RetentionAuditOut) => {
      if (!learnerId) return;
      setPhase({ kind: 'checking', audit: a });
      const sent = await flushOutbox(learnerId);
      if (!mounted.current) return;
      if (!sent) {
        setPhase({ kind: 'offline', audit: a });
        return;
      }
      complete.mutate(a.id, {
        onSuccess: (done) => {
          if (!mounted.current) return;
          sfx('complete');
          setPhase({ kind: 'result', audit: done });
        },
        onError: (e) => {
          if (!mounted.current) return;
          // the server said no (the check expired, too few answers reached it): say why; anything
          // else means it could not be asked, and the answers wait on the device
          if (e instanceof ApiError && e.problem.status >= 400 && e.problem.status < 500)
            setPhase({ kind: 'refused', error: e });
          else setPhase({ kind: 'offline', audit: a });
        },
      });
    },
    [learnerId, complete],
  );

  const header = (
    <ScreenHeader title={t('audit.title')} onBack={onDone} backLabel={t('common.back')} />
  );

  if (phase.kind === 'running') {
    if (located.error) {
      return (
        <Screen header={header}>
          <ProblemNotice problem={asProblem(located.error)} onRetry={onDone} />
        </Screen>
      );
    }
    if (located.pending) {
      return (
        <Screen header={header}>
          <Txt color="ink-3">{t('common.loading')}</Txt>
        </Screen>
      );
    }
    return (
      <AssessmentRunner
        items={located.items}
        units={located.units}
        words={words}
        course={course}
        mode="audit"
        sessionId={phase.audit.id}
        onFinish={() => void check(phase.audit)}
        onLeave={onDone}
      />
    );
  }

  if (phase.kind === 'checking') {
    return (
      <Screen header={header} testID="audit-checking">
        <View style={{ alignItems: 'center', gap: 16, paddingTop: 24 }}>
          <Mascot pose="think" size={120} />
          <Txt variant="title-m" align="center" accessibilityLiveRegion="polite">
            {t('audit.checking')}
          </Txt>
        </View>
      </Screen>
    );
  }

  if (phase.kind === 'offline') {
    return (
      <Screen header={header} testID="audit-offline">
        <View style={{ alignItems: 'center', gap: 16, paddingTop: 24 }}>
          <Mascot pose="rest" size={120} />
          <Txt variant="title-m" align="center">
            {t('audit.offlineTitle')}
          </Txt>
          <Txt color="ink-2" align="center">
            {t('audit.offlineBody')}
          </Txt>
        </View>
        <Button
          block
          onPress={() => void check(phase.audit)}
          busy={complete.isPending}
          testID="audit-recheck"
        >
          {t('audit.checkAgain')}
        </Button>
        <Button block variant="secondary" onPress={onDone}>
          {t('audit.later')}
        </Button>
      </Screen>
    );
  }

  if (phase.kind === 'refused') {
    return (
      <Screen header={header} testID="audit-refused">
        <ProblemNotice problem={asProblem(phase.error)} />
        <Button block onPress={begin} busy={start.isPending} testID="audit-again">
          {t('audit.startAgain')}
        </Button>
        <Button block variant="secondary" onPress={onDone}>
          {t('audit.later')}
        </Button>
      </Screen>
    );
  }

  if (phase.kind === 'result') {
    const { audit: a } = phase;
    const actual = a.actual ?? 0;
    return (
      <Screen header={header} testID="audit-result">
        <View style={{ alignItems: 'center', gap: 14, paddingTop: 12 }}>
          <Mascot pose="happy" size={140} />
          <Txt variant="display-m" align="center" accessibilityRole="header">
            {t('audit.resultTitle')}
          </Txt>
          <Txt variant="body-l" color="ink-2" align="center" testID="audit-compare">
            {t('audit.compare', { predicted: pct(a.predicted), actual: pct(actual) })}
          </Txt>
        </View>
        <View testID={a.raised_retention ? 'audit-raised' : 'audit-on-track'}>
          <Notice
            icon={a.raised_retention ? 'info' : 'check'}
            tone={a.raised_retention ? 'orange' : 'green'}
          >
            {a.raised_retention
              ? t('audit.raised', { target: pct(a.raised_retention) })
              : t('audit.onTrack')}
          </Notice>
        </View>
        <Txt variant="body-s" color="ink-3">
          {t('audit.next')}
        </Txt>
        <Button block onPress={onDone} testID="audit-done">
          {t('common.done')}
        </Button>
      </Screen>
    );
  }

  // intro
  return (
    <Screen header={header} testID="audit-intro">
      <View style={{ alignItems: 'center', gap: 12, paddingTop: 8 }}>
        <Mascot pose="wave" size={120} />
        <Txt variant="display-m" align="center" accessibilityRole="header">
          {t('audit.introTitle')}
        </Txt>
      </View>
      <Card>
        {(['ruleWhat', 'ruleCold', 'ruleWhy', 'ruleMonthly'] as const).map((k) => (
          <View key={k} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="check-circle" size={22} />
            <Txt style={{ flex: 1 }}>{t(`audit.${k}`)}</Txt>
          </View>
        ))}
      </Card>
      {!serverHasAudit ? (
        <Notice icon="info">{t('audit.unavailable')}</Notice>
      ) : start.error ? (
        <ProblemNotice problem={asProblem(start.error)} onRetry={begin} />
      ) : null}
      <Button
        block
        onPress={begin}
        busy={start.isPending}
        disabled={!serverHasAudit || !learnerId}
        testID="audit-start"
      >
        {t('audit.start')}
      </Button>
      <Button block variant="ghost" onPress={onDone} testID="audit-not-now">
        {t('audit.notNow')}
      </Button>
    </Screen>
  );
}
