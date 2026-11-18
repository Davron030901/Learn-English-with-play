import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  Button,
  Card,
  Chip,
  Icon,
  Logo,
  Mascot,
  Screen,
  Txt,
  useTheme,
  type IconName,
} from '@/design';
import { LanguagePicker } from '@/features/LanguagePicker';
import { useOnboarding } from '@/state/onboarding';

export default function Welcome() {
  const { t } = useTranslation();
  const theme = useTheme();
  const refused = useOnboarding((s) => s.refused);
  return (
    <Screen
      testID="welcome"
      background="bg-soft"
      footer={
        <View style={{ gap: 12 }}>
          <Button
            size="lg"
            block
            testID="get-started"
            onPress={() => {
              useOnboarding.getState().set({ startedAt: Date.now() });
              router.push(refused ? '/onboarding/not-yet' : '/onboarding/age');
            }}
          >
            {t('welcome.getStarted')}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            block
            testID="have-account"
            onPress={() => router.push('/sign-in')}
          >
            {t('welcome.haveAccount')}
          </Button>
        </View>
      }
    >
      <View style={{ alignItems: 'center', gap: 20, paddingTop: 16 }}>
        <Logo size={30} />
        <Chip tone="primary">{t('arcade.welcomeBadge')}</Chip>
        <Txt variant="display-m" align="center">
          {t('arcade.welcomeTitle')}
        </Txt>
        <Txt variant="body-l" color="ink-2" align="center">
          {t('welcome.body')}
        </Txt>
        <View style={{ backgroundColor: theme.c['primary-soft'], borderRadius: 40, padding: 20 }}>
          <Mascot pose="wave" size={140} />
        </View>
      </View>
      <Card>
        <Txt variant="title-m">{t('arcade.tryTitle')}</Txt>
        <Txt color="ink-2">{t('arcade.trySub')}</Txt>
        <Button
          block
          icon="play"
          size="lg"
          testID="try-arcade"
          onPress={() => router.push('/arcade')}
        >
          {t('arcade.tryNow')}
        </Button>
      </Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {(['route', 'speaker', 'cards'] as IconName[]).map((icon, i) => (
          <Card key={icon} style={{ flex: 1, minWidth: 160 }}>
            <Icon name={icon} size={28} color={theme.c['primary-ink']} />
            <Txt variant="title-s">{t(`arcade.feature${i + 1}`)}</Txt>
            <Txt variant="body-s" color="ink-2">
              {t(`arcade.feature${i + 1}Sub`)}
            </Txt>
          </Card>
        ))}
      </View>
      <LanguagePicker testID="interface-language" />
    </Screen>
  );
}
