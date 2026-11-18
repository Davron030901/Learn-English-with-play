import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ChoiceCard } from '@/design';
import { OnboardingStep } from '@/features/onboarding/OnboardingStep';
import { useOnboarding } from '@/state/onboarding';

export const REASONS = ['work', 'study', 'travel', 'moving', 'people', 'exam', 'me'] as const;

/**
 * Step 1. The answer weights content selection on the server (docs/10 §11); until the server
 * can receive it, it is kept with the learner's device data and sent when it can be.
 */
export default function Why() {
  const { t } = useTranslation();
  const why = useOnboarding((s) => s.why);
  return (
    <OnboardingStep
      step={1}
      testID="onboarding-why"
      title={t('onboarding.why.title')}
      body={t('onboarding.why.body')}
      canContinue={!!why}
      onContinue={() => router.push('/onboarding/language')}
    >
      <View style={{ gap: 12 }} accessibilityRole="radiogroup">
        {REASONS.map((r) => (
          <ChoiceCard
            key={r}
            font="ui"
            state={why === r ? 'selected' : 'idle'}
            onPress={() => useOnboarding.getState().set({ why: r })}
            testID={`why-${r}`}
          >
            {t(`onboarding.why.${r}`)}
          </ChoiceCard>
        ))}
      </View>
    </OnboardingStep>
  );
}
