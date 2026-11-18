import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View } from 'react-native';

import { serverHasAssessment, useAnswerPlacement, useStartPlacement } from '@/api/queries/assessment';
import type { PlacementOut } from '@/api/types';
import { sfx } from '@/audio/sfx';
import type { Course } from '@/content/model';
import { Button, Card, ChoiceCard, Icon, LevelBadge, Mascot, Notice, Screen, ScreenHeader, Txt } from '@/design';
import { ProblemNotice, asProblem } from '@/features/errors';
import { useLearner } from '@/state/learner';
import { usePrefs } from '@/state/prefs';

import { AssessmentRunner, type AssessmentAnswer } from './AssessmentRunner';
import { useAssessmentItems } from './useItems';

/** Four stages of five at most: a binary search over ten sub-levels (server, docs/12 §2). */
export const PLACEMENT_MAX_ITEMS = 20;

/** The section a placement result points at, 1-based as `startSection` is. */
export function sectionNumber(course: Course, sectionId: string | null | undefined): number {
  const i = course.sections.findIndex((s) => s.id === sectionId);
  return i < 0 ? 1 : i + 1;
}

/**
 * "Find your level" (docs/16 E20, docs/12): about three minutes of quick text items, no audio and
 * no right/wrong while it runs. The result is a suggestion: the learner chooses where to start
 * and nothing earlier is ever locked.
 */
export function Placement({ course, words, onDone }: { course: Course; words: ReadonlySet<string>; onDone: () => void }) {
  const { t } = useTranslation();
  const language = usePrefs((s) => s.interfaceLanguage);
  const update = useLearner((s) => s.update);
  const currentStart = useLearner((s) => s.data.startSection);
  const start = useStartPlacement();
  const answer = useAnswerPlacement();
  const [step, setStep] = useState<PlacementOut | null>(null);
  const [answered, setAnswered] = useState(0);
  const loaded = useAssessmentItems(step && !step.done ? step.item_ids : [], step && !step.done ? step.unit_ids : []);

  const begin = () => {
    setAnswered(0);
    start.mutate(undefined, { onSuccess: setStep });
  };

  const submitStage = (answers: AssessmentAnswer[]) => {
    if (!step) return;
    const body: Record<string, Record<string, unknown>> = {};
    for (const a of answers) body[a.itemId] = { ...a.submission };
    answer.mutate(
      { placementId: step.placement_id, answers: body },
      {
        onSuccess: (next) => {
          setAnswered((n) => n + step.item_ids.length);
          setStep(next);
          if (next.done) {
            sfx('unlock');
            AccessibilityInfo.announceForAccessibility(t('placementCheck.resultTitle'));
          }
        },
      },
    );
  };

  const choose = (section: number) => {
    update((d) => ({ ...d, startSection: section }));
    onDone();
  };

  const header = <ScreenHeader title={t('placementCheck.title')} onBack={onDone} backLabel={t('common.back')} />;

  if (step && !step.done) {
    if (answer.isPending) {
      return (
        <Screen header={header} testID="placement-thinking">
          <View style={{ alignItems: 'center', gap: 16, paddingTop: 24 }}>
            <Mascot pose="think" size={120} />
            <Txt variant="title-m" align="center" accessibilityLiveRegion="polite">
              {t('placementCheck.thinking')}
            </Txt>
          </View>
        </Screen>
      );
    }
    if (answer.error) {
      return (
        <Screen header={header}>
          <ProblemNotice problem={asProblem(answer.error)} onRetry={() => answer.reset()} />
          <Button block variant="secondary" onPress={onDone}>
            {t('placementCheck.later')}
          </Button>
        </Screen>
      );
    }
    if (loaded.pending) {
      return (
        <Screen header={header}>
          <Txt color="ink-3">{t('common.loading')}</Txt>
        </Screen>
      );
    }
    return (
      <AssessmentRunner
        key={`stage-${answered}`}
        items={loaded.items}
        units={loaded.units}
        words={words}
        course={course}
        mode="placement"
        sessionId={step.placement_id}
        offset={answered}
        total={PLACEMENT_MAX_ITEMS}
        onFinish={submitStage}
        onLeave={onDone}
      />
    );
  }

  if (step?.done) {
    const section = sectionNumber(course, step.result_section);
    const unit = step.result_unit ? course.unitsById.get(step.result_unit) : undefined;
    const unitTitle = unit ? (unit.title[language] ?? unit.title.en) : '';
    return (
      <Screen header={header} testID="placement-result">
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 8 }}>
          <Mascot pose="cheer" size={140} />
          <Txt variant="overline" color="ink-3">
            {t('placementCheck.resultTitle')}
          </Txt>
          {step.result_level ? <LevelBadge level={step.result_level} size="lg" /> : null}
          <Txt variant="display-m" align="center" accessibilityRole="header" testID="placement-section">
            {t('placementCheck.resultSection', { n: section })}
          </Txt>
          {unit ? (
            <Txt variant="body-l" color="ink-2" align="center">
              {t('placementCheck.resultUnit', { n: unit.index, title: unitTitle })}
            </Txt>
          ) : null}
        </View>
        <Notice icon="info">{t('placementCheck.resultBody')}</Notice>
        <View style={{ gap: 10 }} accessibilityRole="radiogroup">
          <ChoiceCard font="ui" state="selected" onPress={() => choose(section)} testID="placement-start-here" trailing={<Icon name="arrow-right" size={20} />}>
            {t('placementCheck.startHere', { n: section })}
          </ChoiceCard>
          {section !== 1 ? (
            <ChoiceCard font="ui" onPress={() => choose(1)} testID="placement-from-start">
              {t('placementCheck.fromStart')}
            </ChoiceCard>
          ) : null}
          {currentStart !== section && currentStart !== 1 ? (
            <ChoiceCard font="ui" onPress={onDone} testID="placement-keep">
              {t('placementCheck.keep', { n: currentStart })}
            </ChoiceCard>
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen header={header} testID="placement-intro">
      <View style={{ alignItems: 'center', gap: 12, paddingTop: 8 }}>
        <Mascot pose="listen" size={130} />
        <Txt variant="display-m" align="center" accessibilityRole="header">
          {t('placementCheck.introTitle')}
        </Txt>
        <Txt variant="body-l" color="ink-2" align="center">
          {t('placementCheck.introBody')}
        </Txt>
      </View>
      <Card>
        {(['ruleTime', 'ruleQuiet', 'ruleNoMarks', 'ruleOpen'] as const).map((k) => (
          <View key={k} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="check-circle" size={22} />
            <Txt style={{ flex: 1 }}>{t(`placementCheck.${k}`)}</Txt>
          </View>
        ))}
      </Card>
      {!serverHasAssessment ? (
        <Notice icon="info">{t('placementCheck.unavailable')}</Notice>
      ) : start.error ? (
        <ProblemNotice problem={asProblem(start.error)} onRetry={begin} />
      ) : null}
      <Button block onPress={begin} busy={start.isPending} disabled={!serverHasAssessment} testID="placement-begin">
        {t('placementCheck.start')}
      </Button>
      <Button block variant="ghost" onPress={onDone}>
        {t('placementCheck.notNow')}
      </Button>
    </Screen>
  );
}
