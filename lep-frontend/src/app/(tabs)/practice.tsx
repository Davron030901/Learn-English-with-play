import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';

import { Button, Card, Screen, Txt } from '@/design';
import { Garden } from '@/features/garden/Garden';
import { PracticeExtras } from '@/features/garden/PracticeExtras';

/**
 * Practice is the Word Garden (docs/16 E09): every learned word is a plant whose stage is its
 * memory and whose health is its due date, and watering is the review the server's scheduler
 * composed. Mixed practice and the saved words stay here, below the garden.
 */
export default function PracticeScreen() {
  const { t } = useTranslation();
  return (
    <Screen edges={['top']} testID="practice">
      <Txt variant="display-m" accessibilityRole="header">
        {t('garden.title')}
      </Txt>
      <Card>
        <Txt variant="title-m">{t('arcade.title')}</Txt>
        <Txt color="ink-2">{t('arcade.subtitle')}</Txt>
        <Button icon="play" onPress={() => router.push('/arcade')}>
          {t('arcade.start')}
        </Button>
      </Card>
      <Garden />
      <PracticeExtras />
    </Screen>
  );
}
