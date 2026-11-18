import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ChoiceCard } from '@/design';
import { OnboardingStep } from '@/features/onboarding/OnboardingStep';
import { useOnboarding } from '@/state/onboarding';

/** Step 3: a beginner goes straight to Section 1; anyone else is offered placement (step 4). */
export default function Level() {
  const { t } = useTranslation();
  const level = useOnboarding((s) => s.level);
  const set = useOnboarding((s) => s.set);
  return (
    <OnboardingStep
      step={3}
      testID="onboarding-level"
      title={t('onboarding.level.title')}
      canContinue={!!level}
      onContinue={() => {
        if (level === 'none') {
          set({ startSection: 1 });
          router.push('/onboarding/time');
        } else {
          router.push('/onboarding/placement');
        }
      }}
    >
      <View style={{ gap: 12 }} accessibilityRole="radiogroup">
        {(['none', 'some', 'lot'] as const).map((l) => (
          <ChoiceCard key={l} font="ui" state={level === l ? 'selected' : 'idle'} onPress={() => set({ level: l })} testID={`level-${l}`}>
            {t(`onboarding.level.${l}`)}
          </ChoiceCard>
        ))}
      </View>
    </OnboardingStep>
  );
}
