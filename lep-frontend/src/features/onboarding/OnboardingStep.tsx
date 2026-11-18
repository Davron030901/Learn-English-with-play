import { router } from 'expo-router';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, ProgressBar, Screen, ScreenHeader, Txt } from '@/design';

export const ONBOARDING_STEPS = 8;

/** The frame of every onboarding step: position, question, answer area, one primary action. */
export function OnboardingStep({
  step,
  title,
  body,
  children,
  continueLabel,
  onContinue,
  canContinue = true,
  secondary,
  testID,
}: {
  step?: number;
  title: string;
  body?: string;
  children?: ReactNode;
  continueLabel?: string;
  onContinue?: () => void;
  canContinue?: boolean;
  secondary?: ReactNode;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <Screen
      testID={testID}
      header={
        <ScreenHeader
          backLabel={t('common.back')}
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
          trailing={
            step ? (
              <Txt variant="caption" color="ink-3" style={{ paddingEnd: 12 }}>
                {t('onboarding.step', { n: step, total: ONBOARDING_STEPS })}
              </Txt>
            ) : undefined
          }
        />
      }
      footer={
        onContinue ? (
          <View style={{ gap: 10 }}>
            {secondary}
            <Button size="lg" block disabled={!canContinue} onPress={onContinue} testID="onboarding-continue">
              {continueLabel ?? t('common.continue')}
            </Button>
          </View>
        ) : (
          secondary
        )
      }
    >
      {step ? <ProgressBar value={step} max={ONBOARDING_STEPS} size="sm" label={t('onboarding.step', { n: step, total: ONBOARDING_STEPS })} /> : null}
      <View style={{ gap: 8 }}>
        <Txt variant="display-m" accessibilityRole="header">
          {title}
        </Txt>
        {body ? (
          <Txt variant="body-l" color="ink-2">
            {body}
          </Txt>
        ) : null}
      </View>
      {children}
    </Screen>
  );
}
