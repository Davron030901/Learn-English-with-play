import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Mascot, Screen, Txt } from '@/design';

/** The kind refusal for under-13s (brief §9): no blame, no retry prompt, nothing kept. */
export default function NotYet() {
  const { t } = useTranslation();
  return (
    <Screen
      testID="not-yet"
      footer={
        <Button size="lg" block onPress={() => router.replace('/welcome')}>
          {t('onboarding.notYet.ok')}
        </Button>
      }
    >
      <View style={{ alignItems: 'center', gap: 16, paddingTop: 32 }}>
        <Mascot pose="wave" size={140} />
        <Txt variant="display-m" align="center" accessibilityRole="header">
          {t('onboarding.notYet.title')}
        </Txt>
        <Txt variant="body-l" color="ink-2" align="center">
          {t('onboarding.notYet.body')}
        </Txt>
        <Txt variant="body-m" color="ink-3" align="center">
          {t('onboarding.notYet.tip')}
        </Txt>
      </View>
    </Screen>
  );
}
