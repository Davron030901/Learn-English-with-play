import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, Mascot, Screen, ScreenHeader, Txt } from '@/design';
import { WritingTasks } from '@/features/assessment/Writing';
import { bandOf } from '@/features/progress/LevelConditionsCard';

function done() {
  if (router.canGoBack()) router.back();
  else router.replace('/progress');
}

/** /writing/:level — writing for a level, half of the production condition (docs/12 §5). */
export default function WritingRoute() {
  const { t } = useTranslation();
  const { level: raw = '' } = useLocalSearchParams<{ level: string }>();
  const level = raw.length === 2 ? bandOf(raw) : null;
  if (!level) {
    return (
      <Screen
        header={
          <ScreenHeader
            title={t('writing.title', { level: raw })}
            onBack={done}
            backLabel={t('common.back')}
          />
        }
        testID="writing-not-found"
      >
        <Mascot pose="think" size={120} />
        <Txt variant="title-m">{t('errors.not_found')}</Txt>
        <Button onPress={done}>{t('common.back')}</Button>
      </Screen>
    );
  }
  return <WritingTasks level={level} onDone={done} />;
}
