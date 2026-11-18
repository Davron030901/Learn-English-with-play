import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { serverHasPasswordReset, useCapabilities, useForgotPassword } from '@/api/queries/account';
import { Button, Mascot, Notice, Screen, ScreenHeader, TextField, Txt } from '@/design';
import { asProblem, ProblemNotice } from '@/features/errors';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A forgotten password (backend DECISIONS §14.3, frontend §22). The server answers the same for
 * every address — whether or not an account uses it — and so does this screen: "if an account
 * uses this address, a link is on its way". Where the server has no mail backend (503
 * password_reset_unavailable, or capabilities say so) the screen explains how to get help
 * instead, as before (B5).
 */
export default function Forgot() {
  const { t } = useTranslation();
  const capabilities = useCapabilities();
  const forgot = useForgotPassword();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; minutes: number } | null>(null);

  const problem = forgot.error ? asProblem(forgot.error) : null;
  const unavailable =
    !serverHasPasswordReset ||
    capabilities.data?.password_reset === false ||
    problem?.type === 'password_reset_unavailable';

  const back = () => (router.canGoBack() ? router.back() : router.replace('/sign-in'));

  const submit = () => {
    const address = email.trim();
    if (!EMAIL.test(address)) {
      setEmailError(t('field.emailInvalid'));
      return;
    }
    setEmailError(null);
    forgot.mutate(address, {
      onSuccess: (out) => setSent({ email: address, minutes: out.expires_in_minutes }),
    });
  };

  if (unavailable) {
    return (
      <Screen
        testID="forgot"
        header={<ScreenHeader backLabel={t('common.back')} onBack={back} />}
        footer={
          <Button size="lg" block variant="secondary" onPress={() => router.replace('/sign-in')}>
            {t('forgot.back')}
          </Button>
        }
      >
        <Mascot pose="think" size={100} />
        <Txt variant="display-m" accessibilityRole="header">
          {t('forgot.title')}
        </Txt>
        <Notice icon="info">{t('forgot.body')}</Notice>
        <Txt variant="body-l" color="ink-2">
          {t('forgot.help')}
        </Txt>
      </Screen>
    );
  }

  if (sent) {
    return (
      <Screen
        testID="forgot-sent"
        header={<ScreenHeader backLabel={t('common.back')} onBack={back} />}
        footer={
          <Button size="lg" block onPress={() => router.replace('/sign-in')} testID="forgot-back">
            {t('forgot.back')}
          </Button>
        }
      >
        <Mascot pose="happy" size={100} />
        <Txt variant="display-m" accessibilityRole="header" accessibilityLiveRegion="polite">
          {t('forgot.sentTitle')}
        </Txt>
        <Txt variant="body-l">
          {t('forgot.sentBody', { email: sent.email, minutes: sent.minutes })}
        </Txt>
        <Txt variant="body-s" color="ink-2">
          {t('forgot.sentHint')}
        </Txt>
      </Screen>
    );
  }

  return (
    <Screen
      testID="forgot"
      header={<ScreenHeader backLabel={t('common.back')} onBack={back} />}
      footer={
        <Button size="lg" block busy={forgot.isPending} onPress={submit} testID="forgot-submit">
          {forgot.isPending ? t('forgot.working') : t('forgot.submit')}
        </Button>
      }
    >
      <Mascot pose="think" size={100} />
      <Txt variant="display-m" accessibilityRole="header">
        {t('forgot.title')}
      </Txt>
      <Txt variant="body-l" color="ink-2">
        {t('forgot.intro')}
      </Txt>
      <View style={{ gap: 16 }}>
        <TextField
          label={t('field.email')}
          value={email}
          onChangeText={setEmail}
          error={emailError}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="go"
          onSubmitEditing={submit}
          testID="forgot-email"
        />
      </View>
      {problem ? <ProblemNotice problem={problem} context="auth" testID="forgot-error" /> : null}
      <Txt variant="body-s" color="ink-2">
        {t('forgot.help')}
      </Txt>
    </Screen>
  );
}
