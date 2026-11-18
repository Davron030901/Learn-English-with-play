import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View } from 'react-native';

import {
  serverHasAssessment,
  useCompleteCheckpoint,
  useStartCheckpoint,
} from '@/api/queries/assessment';
import type { CheckpointOut, CheckpointResultOut } from '@/api/types';
import { sfx } from '@/audio/sfx';
import type { Course, Tier, UnitOutline } from '@/content/model';
import {
  Button,
  Card,
  Chip,
  Icon,
  LevelBadge,
  Mascot,
  Notice,
  Screen,
  ScreenHeader,
  Txt,
} from '@/design';
import { ProblemNotice, asProblem } from '@/features/errors';
import { log } from '@/lib/log';
import { useAwards } from '@/state/awards';
import { useLearner } from '@/state/learner';
import { usePrefs } from '@/state/prefs';

import { AssessmentRunner } from './AssessmentRunner';
import { flushOutbox } from './flush';
import { useAssessmentItems } from './useItems';

type Phase =
  | { kind: 'intro' }
  | { kind: 'running'; form: CheckpointOut }
  | { kind: 'checking'; form: CheckpointOut }
  | { kind: 'offline'; form: CheckpointOut }
  | { kind: 'result'; form: CheckpointOut; result: CheckpointResultOut };

/**
 * "Already know this? Test out" (docs/16 E14, docs/10 §4): twelve items, 85 % passes, free,
 * unlimited and never a gate — the unit stays open either way. The answers count as practice.
 */
export function TestOut({
  outline,
  course,
  words,
  onDone,
}: {
  outline: UnitOutline;
  course: Course;
  words: ReadonlySet<string>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const language = usePrefs((s) => s.interfaceLanguage);
  const learnerId = useLearner((s) => s.learnerId);
  const markCompleted = useLearner((s) => s.markCompleted);
  const start = useStartCheckpoint();
  const complete = useCompleteCheckpoint();
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const form = phase.kind === 'intro' ? null : phase.form;
  const loaded = useAssessmentItems(form?.item_ids ?? [], form ? [form.unit_id] : []);
  const title = outline.title[language] ?? outline.title.en;
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const begin = () => {
    start.mutate(outline.id, {
      onSuccess: (f) => setPhase({ kind: 'running', form: f }),
      onError: (e) => log.info('testout.start_failed', e),
    });
  };

  const check = useCallback(
    async (f: CheckpointOut) => {
      if (!learnerId) return;
      setPhase({ kind: 'checking', form: f });
      const sent = await flushOutbox(learnerId);
      if (!mounted.current) return;
      if (!sent) {
        setPhase({ kind: 'offline', form: f });
        return;
      }
      complete.mutate(f.checkpoint_id, {
        onSuccess: (result) => {
          if (!mounted.current) return;
          if (result.passed) {
            // The server credited the unit; the device's path shows it at once, even offline later.
            for (const node of outline.nodes)
              for (const tier of node.populatedTiers)
                if (tier <= 2) markCompleted(node.id, tier as Tier);
            useAwards.getState().push(result.awards);
            sfx('levelup');
            AccessibilityInfo.announceForAccessibility(t('testOut.passedTitle'));
          }
          setPhase({ kind: 'result', form: f, result });
        },
        onError: () => mounted.current && setPhase({ kind: 'offline', form: f }),
      });
    },
    [learnerId, complete, outline.nodes, markCompleted, t],
  );

  if (phase.kind === 'running') {
    if (loaded.error) {
      return (
        <Screen header={<ScreenHeader onBack={onDone} backLabel={t('common.back')} />}>
          <ProblemNotice problem={asProblem(loaded.error)} onRetry={onDone} />
        </Screen>
      );
    }
    if (loaded.pending) {
      return (
        <Screen>
          <Txt color="ink-3">{t('common.loading')}</Txt>
        </Screen>
      );
    }
    return (
      <AssessmentRunner
        items={loaded.items}
        units={loaded.units}
        words={words}
        course={course}
        mode="testOut"
        sessionId={phase.form.checkpoint_id}
        onFinish={() => void check(phase.form)}
        onLeave={onDone}
      />
    );
  }

  const header = (
    <ScreenHeader title={t('testOut.title')} onBack={onDone} backLabel={t('common.back')} />
  );

  if (phase.kind === 'checking') {
    return (
      <Screen header={header} testID="testout-checking">
        <View style={{ alignItems: 'center', gap: 16, paddingTop: 24 }}>
          <Mascot pose="think" size={120} />
          <Txt variant="title-m" align="center" accessibilityLiveRegion="polite">
            {t('testOut.checking')}
          </Txt>
        </View>
      </Screen>
    );
  }

  if (phase.kind === 'offline') {
    return (
      <Screen header={header} testID="testout-offline">
        <View style={{ alignItems: 'center', gap: 16, paddingTop: 24 }}>
          <Mascot pose="rest" size={120} />
          <Txt variant="title-m" align="center">
            {t('testOut.offlineTitle')}
          </Txt>
          <Txt color="ink-2" align="center">
            {t('testOut.offlineBody')}
          </Txt>
        </View>
        <Button
          block
          onPress={() => void check(phase.form)}
          busy={complete.isPending}
          testID="testout-recheck"
        >
          {t('testOut.checkAgain')}
        </Button>
        <Button block variant="secondary" onPress={onDone}>
          {t('testOut.later')}
        </Button>
      </Screen>
    );
  }

  if (phase.kind === 'result') {
    const { result } = phase;
    const right = result.accuracy === null ? 0 : Math.round(result.accuracy * result.answered);
    const pct = result.accuracy === null ? 0 : Math.round(result.accuracy * 100);
    return (
      <Screen header={header} testID={result.passed ? 'testout-passed' : 'testout-not-yet'}>
        <View style={{ alignItems: 'center', gap: 14, paddingTop: 12 }}>
          <Mascot pose={result.passed ? 'cheer' : 'happy'} size={140} />
          <Txt variant="display-m" align="center" accessibilityRole="header">
            {result.passed ? t('testOut.passedTitle') : t('testOut.notYetTitle')}
          </Txt>
          <Txt variant="body-l" color="ink-2" align="center" testID="testout-score">
            {t('testOut.score', { right, total: result.total, pct })}
          </Txt>
        </View>
        {result.passed ? (
          <Card>
            <Txt variant="title-s">{t('testOut.passedBody', { unit: title })}</Txt>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {result.awards.gems > 0 ? (
                <Chip tone="gem" icon="gem">
                  {t('testOut.gems', { n: result.awards.gems })}
                </Chip>
              ) : null}
              {result.awards.xp > 0 ? (
                <Chip tone="xp" icon="bolt">
                  {t('testOut.xp', { n: result.awards.xp })}
                </Chip>
              ) : null}
              {result.awards.badges.length > 0 ? (
                <Chip tone="purple" icon="medal">
                  {t('testOut.stamps', { count: result.awards.badges.length })}
                </Chip>
              ) : null}
            </View>
          </Card>
        ) : (
          <Notice icon="info">{t('testOut.notYetBody')}</Notice>
        )}
        {result.passed ? (
          <Button block onPress={onDone} testID="testout-continue">
            {t('testOut.continue')}
          </Button>
        ) : (
          <>
            <Button block onPress={begin} busy={start.isPending} testID="testout-again">
              {t('testOut.tryAgain')}
            </Button>
            <Button block variant="secondary" onPress={onDone} testID="testout-learn">
              {t('testOut.learnUnit')}
            </Button>
          </>
        )}
      </Screen>
    );
  }

  // intro
  return (
    <Screen header={header} testID="testout-intro">
      <View style={{ alignItems: 'center', gap: 12, paddingTop: 8 }}>
        <Mascot pose="wave" size={120} />
        <LevelBadge level={outline.cefr} />
        <Txt variant="display-m" align="center" accessibilityRole="header">
          {t('testOut.introTitle', { n: outline.index })}
        </Txt>
        <Txt variant="body-l" color="ink-2" align="center">
          {title}
        </Txt>
      </View>
      <Card>
        {(['rule12', 'ruleFree', 'rulePractice', 'ruleOpen'] as const).map((k) => (
          <View key={k} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="check-circle" size={22} />
            <Txt style={{ flex: 1 }}>{t(`testOut.${k}`)}</Txt>
          </View>
        ))}
      </Card>
      {!serverHasAssessment ? (
        <Notice icon="info">{t('testOut.unavailable')}</Notice>
      ) : start.error ? (
        <ProblemNotice problem={asProblem(start.error)} onRetry={begin} />
      ) : null}
      <Button
        block
        onPress={begin}
        busy={start.isPending}
        disabled={!serverHasAssessment || !learnerId}
        testID="testout-start"
      >
        {t('testOut.start')}
      </Button>
      <Button block variant="ghost" onPress={onDone} testID="testout-not-now">
        {t('testOut.notNow')}
      </Button>
    </Screen>
  );
}
