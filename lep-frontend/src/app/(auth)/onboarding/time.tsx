import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ChoiceCard } from '@/design';
import { OnboardingStep } from '@/features/onboarding/OnboardingStep';
import { useOnboarding } from '@/state/onboarding';

/** Step 5: the daily goal (the backend's enum 5/10/20/40), with its honest yearly total. */
const GOALS = [
  { min: 5, key: 'casual' },
  { min: 10, key: 'regular' },
  { min: 20, key: 'serious' },
  { min: 40, key: 'intense' },
] as const;

export default function Time() {
  const { t } = useTranslation();
  const goal = useOnboarding((s) => s.dailyGoal);
  const set = useOnboarding((s) => s.set);
  return (
    <OnboardingStep
      step={5}
      testID="onboarding-time"
      title={t('onboarding.time.title')}
      body={t('onboarding.time.body')}
      onContinue={() => router.push('/onboarding/plan')}
    >
      <View style={{ gap: 12 }} accessibilityRole="radiogroup">
        {GOALS.map((g) => (
          <ChoiceCard
            key={g.min}
            font="ui"
            state={goal === g.min ? 'selected' : 'idle'}
            sub={`${t(`onboarding.time.${g.key}`)} · ${t('onboarding.time.perYear', { hours: Math.round((g.min * 365) / 60) })}`}
            onPress={() => set({ dailyGoal: g.min })}
            testID={`goal-${g.min}`}
          >
            {t('common.minutes', { count: g.min })}
          </ChoiceCard>
        ))}
      </View>
    </OnboardingStep>
  );
}
