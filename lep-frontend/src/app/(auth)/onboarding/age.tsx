import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TextField } from '@/design';
import { OnboardingStep } from '@/features/onboarding/OnboardingStep';
import { mightBeUnder13, useOnboarding } from '@/state/onboarding';

/**
 * A neutral birth-year question first (DECISIONS F21): it gives no hint of the answer that
 * "works", and a refusal is kind and final for this run. The year lives in memory only and is
 * cleared on refusal — never stored, never logged.
 */
export default function Age() {
  const { t } = useTranslation();
  const refused = useOnboarding((s) => s.refused);
  const [text, setText] = useState('');
  const thisYear = new Date().getFullYear();
  const year = /^\d{4}$/.test(text) ? Number(text) : null;
  const valid = year !== null && year >= 1900 && year <= thisYear;
  if (refused) return <Redirect href="/onboarding/not-yet" />;
  return (
    <OnboardingStep
      testID="onboarding-age"
      title={t('onboarding.age.title')}
      body={t('onboarding.age.body')}
      canContinue={valid}
      onContinue={() => {
        if (!valid || year === null) return;
        if (mightBeUnder13(year)) {
          useOnboarding.getState().refuse();
          setText('');
          router.replace('/onboarding/not-yet');
          return;
        }
        useOnboarding.getState().set({ birthYear: year });
        router.push('/onboarding/why');
      }}
    >
      <TextField
        label={t('field.birthYear')}
        value={text}
        onChangeText={(v) => setText(v.replace(/[^0-9]/g, '').slice(0, 4))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={4}
        placeholder="YYYY"
        testID="birth-year"
      />
    </OnboardingStep>
  );
}
