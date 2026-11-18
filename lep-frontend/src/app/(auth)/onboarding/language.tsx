import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { glossLanguages } from '@/content/version.generated';
import { ChoiceCard, SectionTitle, Txt } from '@/design';
import { OnboardingStep } from '@/features/onboarding/OnboardingStep';
import { useOnboarding } from '@/state/onboarding';

/**
 * Step 2. L1 is not a two-language switch (brief §4.1): the languages offered are the ones the
 * course's lexicon carries glosses in (derived from the content by the packer); others are
 * listed as coming later. The server validates the tag against its own configuration.
 * The spelling variant chooses the synthetic voice's accent; both spellings are always accepted.
 */
const LATER = ['kk', 'tg', 'ky', 'tk', 'tr', 'az', 'ar', 'fa', 'hi', 'zh'] as const;

export default function Language() {
  const { t } = useTranslation();
  const l1 = useOnboarding((s) => s.l1);
  const spelling = useOnboarding((s) => s.spellingVariant);
  const set = useOnboarding((s) => s.set);
  return (
    <OnboardingStep
      step={2}
      testID="onboarding-language"
      title={t('onboarding.l1.title')}
      body={t('onboarding.l1.body')}
      canContinue={!!l1}
      onContinue={() => router.push('/onboarding/level')}
    >
      <View style={{ gap: 12 }} accessibilityRole="radiogroup">
        {glossLanguages.map((code) => (
          <ChoiceCard key={code} font="ui" lang={code} state={l1 === code ? 'selected' : 'idle'} onPress={() => set({ l1: code })} testID={`l1-${code}`}>
            {t(`languages.${code}`)}
          </ChoiceCard>
        ))}
        {LATER.map((code) => (
          <ChoiceCard key={code} font="ui" state="dim" disabled sub={t('onboarding.l1.notYet')}>
            {t(`languages.${code}`)}
          </ChoiceCard>
        ))}
      </View>
      <View style={{ gap: 12 }}>
        <SectionTitle>{t('onboarding.l1.spellingTitle')}</SectionTitle>
        <Txt variant="body-m" color="ink-2">
          {t('onboarding.l1.spellingBody')}
        </Txt>
        <View style={{ gap: 12 }} accessibilityRole="radiogroup">
          <ChoiceCard font="ui" state={spelling === 'us' ? 'selected' : 'idle'} sub={t('onboarding.l1.usSub')} onPress={() => set({ spellingVariant: 'us' })} testID="spelling-us">
            {t('onboarding.l1.us')}
          </ChoiceCard>
          <ChoiceCard font="ui" state={spelling === 'uk' ? 'selected' : 'idle'} sub={t('onboarding.l1.ukSub')} onPress={() => set({ spellingVariant: 'uk' })} testID="spelling-uk">
            {t('onboarding.l1.uk')}
          </ChoiceCard>
        </View>
      </View>
    </OnboardingStep>
  );
}
