import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCourse } from '@/content/queries';
import { ChoiceCard, LevelBadge, Notice } from '@/design';
import { OnboardingStep } from '@/features/onboarding/OnboardingStep';
import { useOnboarding } from '@/state/onboarding';

/**
 * Step 4. The placement check needs an account (it runs on the server, docs/12), so before sign-up
 * the step points to it (Profile → Find your level) and lets the learner choose where to start —
 * visibly skippable (brief Phase 7). Nothing here pretends to measure the learner.
 */
export default function Placement() {
  const { t } = useTranslation();
  const course = useCourse();
  const start = useOnboarding((s) => s.startSection);
  const set = useOnboarding((s) => s.set);
  const next = () => router.push('/onboarding/time');
  return (
    <OnboardingStep
      step={4}
      testID="onboarding-placement"
      title={t('onboarding.placement.title')}
      onContinue={next}
      secondary={
        <ChoiceCard font="ui" onPress={() => { set({ startSection: 1 }); next(); }} testID="placement-skip">
          {t('onboarding.placement.skip')}
        </ChoiceCard>
      }
    >
      <Notice icon="info">{t('onboarding.placement.body')}</Notice>
      <View style={{ gap: 10 }} accessibilityRole="radiogroup">
        {(course.data?.sections ?? []).map((s, i) => (
          <ChoiceCard
            key={s.id}
            font="ui"
            state={start === i + 1 ? 'selected' : 'idle'}
            sub={s.units[0]?.title.en}
            onPress={() => set({ startSection: i + 1 })}
            trailing={<LevelBadge level={s.cefr} size="sm" />}
            testID={`placement-${s.id}`}
          >
            {i === 0 ? t('onboarding.placement.fromStart') : t('common.section', { n: i + 1 })}
          </ChoiceCard>
        ))}
      </View>
    </OnboardingStep>
  );
}
