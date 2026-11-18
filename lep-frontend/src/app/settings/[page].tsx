import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, Screen, ScreenHeader, Txt } from '@/design';
import { PAGE_TITLE, SettingsPage, isSettingsPage } from '@/features/settings/SettingsPages';

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/profile');
}

/** /settings/:page — one settings page (Me → Settings). */
export default function SettingsRoute() {
  const { t } = useTranslation();
  const { page = '' } = useLocalSearchParams<{ page: string }>();
  if (!isSettingsPage(page)) {
    return (
      <Screen header={<ScreenHeader onBack={back} backLabel={t('common.back')} />}>
        <Txt variant="title-m">{t('errors.not_found')}</Txt>
        <Button onPress={back}>{t('common.back')}</Button>
      </Screen>
    );
  }
  return (
    <Screen header={<ScreenHeader title={t(PAGE_TITLE[page])} onBack={back} backLabel={t('common.back')} />} testID={`settings-page-${page}`}>
      <Txt variant="display-m" accessibilityRole="header">
        {t(PAGE_TITLE[page])}
      </Txt>
      <SettingsPage page={page} />
    </Screen>
  );
}
