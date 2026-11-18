import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { session } from '@/api/client';
import { useResetPassword } from '@/api/queries/account';
import { useAuthStatus } from '@/api/queries/me';
import { Button, Mascot, Notice, Screen, ScreenHeader, TextField, Txt } from '@/design';
import { asProblem, ProblemNotice, problemMessage } from '@/features/errors';

const MIN_LENGTH = 10;

/**
 * The page a reset letter links to (`/reset-password?token=…` on the web, `lep://reset-password?
 * token=…` in the app; backend DECISIONS §14.3, frontend §22). It is open whether or not someone
 * is signed in here. The token is sent once and never logged or kept; a successful reset ends
 * every session of the account on the server, so this device signs out too and the learner signs
 * in with the new password.
 */
export default function ResetPassword() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = typeof params.token === 'string' && params.token.length >= 20 ? params.token : null;
  const status = useAuthStatus();
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const problem = reset.error ? asProblem(reset.error) : null;
  const linkDead = !token || problem?.type === 'reset_link_invalid';
  const leave = () => router.replace(status === 'signedIn' ? '/' : '/sign-in');

  const submit = () => {
    if (!token) return;
    if (password.length < MIN_LENGTH) {
      setFieldError(t('field.passwordShort'));
      return;
    }
    setFieldError(null);
    reset.mutate(
      { token, password },
      {
        onSuccess: () => {
          setPassword('');
          setDone(true);
          // the server ended every session of the account; end this device's copy as well
          if (session.getStatus() === 'signedIn') void session.signOut('revoked');
        },
        onError: (e) => {
          const p = asProblem(e);
          setFieldError(p.type === 'password_refused' ? problemMessage(t, p) : null);
        },
      },
    );
  };

  const header = <ScreenHeader backLabel={t('common.back')} onBack={leave} />;

  if (done) {
    return (
      <Screen
        testID="reset-done"
        header={header}
        footer={
          <Button size="lg" block onPress={() => router.replace('/sign-in')} testID="reset-sign-in">
            {t('reset.signIn')}
          </Button>
        }
      >
        <Mascot pose="happy" size={110} />
        <Txt variant="display-m" accessibilityRole="header" accessibilityLiveRegion="polite">
          {t('reset.doneTitle')}
        </Txt>
        <Txt variant="body-l" color="ink-2">
          {t('reset.doneBody')}
        </Txt>
      </Screen>
    );
  }

  if (linkDead) {
    return (
      <Screen
        testID="reset-invalid"
        header={header}
        footer={
          <Button
            size="lg"
            block
            onPress={() => router.replace('/forgot')}
            testID="reset-ask-again"
          >
            {t('reset.askAgain')}
          </Button>
        }
      >
        <Mascot pose="think" size={100} />
        <Txt variant="display-m" accessibilityRole="header">
          {t('reset.invalidTitle')}
        </Txt>
        <Txt variant="body-l" color="ink-2">
          {token ? t('reset.invalidBody') : t('reset.missingToken')}
        </Txt>
      </Screen>
    );
  }

  return (
    <Screen
      testID="reset-password"
      header={header}
      footer={
        <Button size="lg" block busy={reset.isPending} onPress={submit} testID="reset-submit">
          {reset.isPending ? t('reset.working') : t('reset.submit')}
        </Button>
      }
    >
      <Txt variant="display-m" accessibilityRole="header">
        {t('reset.title')}
      </Txt>
      <Txt variant="body-l" color="ink-2">
        {t('reset.intro')}
      </Txt>
      <View style={{ gap: 12 }}>
        <TextField
          label={t('reset.newPassword')}
          value={password}
          onChangeText={setPassword}
          error={fieldError}
          secure
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
          testID="reset-new-password"
        />
        <Txt variant="body-s" color="ink-3">
          {t('password.hint')}
        </Txt>
      </View>
      {problem && problem.type !== 'password_refused' && problem.type !== 'reset_link_invalid' ? (
        <ProblemNotice problem={problem} context="auth" testID="reset-error" />
      ) : null}
      {status === 'signedIn' ? <Notice icon="info">{t('reset.signedInNote')}</Notice> : null}
    </Screen>
  );
}
