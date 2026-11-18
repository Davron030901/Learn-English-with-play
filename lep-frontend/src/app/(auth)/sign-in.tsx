import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type TextInput } from 'react-native';

import { session } from '@/api/client';
import type { ApiProblem } from '@/api/problem';
import { Button, Screen, ScreenHeader, TextField, TextLink, Txt } from '@/design';
import { asProblem, ProblemNotice } from '@/features/errors';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignIn() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    setProblem(null);
    if (!EMAIL.test(email.trim())) {
      setEmailError(t('field.emailInvalid'));
      return;
    }
    setEmailError(null);
    if (!password) return;
    setBusy(true);
    try {
      await session.signIn(email.trim(), password);
      // The signed-in guard takes the learner to the path; nothing else to do.
    } catch (e) {
      // The form keeps its values: a 503 is "try again", never "wrong password" (brief §4.3).
      setProblem(asProblem(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      testID="sign-in"
      header={<ScreenHeader backLabel={t('common.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))} />}
      footer={
        <Button size="lg" block busy={busy} onPress={() => void submit()} testID="sign-in-submit">
          {busy ? t('signIn.working') : t('signIn.submit')}
        </Button>
      }
    >
      <Txt variant="display-m" accessibilityRole="header">
        {t('signIn.title')}
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
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          testID="email"
        />
        <TextField
          ref={passwordRef}
          label={t('field.password')}
          value={password}
          onChangeText={setPassword}
          secure
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          testID="password"
        />
      </View>
      {problem ? <ProblemNotice problem={problem} context="auth" testID="sign-in-error" /> : null}
      <View style={{ gap: 4 }}>
        <TextLink onPress={() => router.push('/forgot')}>{t('signIn.forgot')}</TextLink>
        <TextLink onPress={() => router.replace('/onboarding/age')}>{t('signIn.noAccount')}</TextLink>
      </View>
    </Screen>
  );
}
