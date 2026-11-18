import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Mascot, Screen, Txt } from '@/design';

/** Any URL the app does not know (deep links, typed web addresses). */
export default function NotFound() {
  const { t } = useTranslation();
  return (
    <Screen testID="not-found">
      <View style={{ alignItems: 'center', gap: 16, paddingTop: 48 }}>
        <Mascot pose="think" size={120} />
        <Txt variant="title-l" align="center" accessibilityRole="header">
          {t('errors.not_found')}
        </Txt>
        <Button onPress={() => router.replace('/')}>{t('errors.boundaryHome')}</Button>
      </View>
    </Screen>
  );
}
