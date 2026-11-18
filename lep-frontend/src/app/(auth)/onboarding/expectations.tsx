import { router } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card, HonestTimeline, Mascot, SpeechBubble, Txt } from '@/design';
import { OnboardingStep } from '@/features/onboarding/OnboardingStep';
import { useOnboarding } from '@/state/onboarding';

/**
 * Step 7 — the honest expectation screen (docs/10 §11). It comes before any payment surface and
 * no route skips it: account creation is reachable only through this screen's button.
 */
export default function Expectations() {
  const { t } = useTranslation();
  const goal = useOnboarding((s) => s.dailyGoal);
  const minutes = [goal, 60];
  useEffect(() => {
    useOnboarding.getState().set({ sawExpectations: true });
  }, []);
  return (
    <OnboardingStep
      step={7}
      testID="onboarding-expectations"
      title={t('onboarding.expect.title')}
      continueLabel={t('onboarding.expect.continue')}
      onContinue={() => router.push('/onboarding/account')}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Mascot pose="think" size={84} />
        <View style={{ flex: 1 }}>
          <SpeechBubble>
            <Txt variant="body-m" weight={700} testID="honest-quote">
              {t('onboarding.expect.quote')}
            </Txt>
          </SpeechBubble>
        </View>
      </View>
      <Card>
        <Txt variant="title-s">{t('onboarding.expect.yours', { minutes: goal })}</Txt>
        <HonestTimeline minutes={minutes} size="lg" />
      </Card>
    </OnboardingStep>
  );
}
