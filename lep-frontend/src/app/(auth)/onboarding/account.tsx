import { getCalendars } from 'expo-localization';
import { Redirect, router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type TextInput } from 'react-native';

import { session } from '@/api/client';
import type { ApiProblem } from '@/api/problem';
import { Button, Notice, TextField, TextLink } from '@/design';
import { asProblem, ProblemNotice, problemMessage, RequestId } from '@/features/errors';
import { OnboardingStep } from '@/features/onboarding/OnboardingStep';
import { log } from '@/lib/log';
import { applyReminders } from '@/notifications/reminders';
import { useLearner } from '@/state/learner';
import { useOnboarding } from '@/state/onboarding';
import { usePrefs } from '@/state/prefs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function deviceTimeZone(): string | null {
  try {
    const tz = getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.includes('/') ? tz : tz === 'UTC' ? 'UTC' : null;
  } catch {
    return null;
  }
}

/**
 * Account creation, after step 7 (DECISIONS F21). The client mirrors the password rules as
 * hints only; the server decides (DECISIONS B4). An under-13 refusal from the server clears the
 * birth year and shows the kind screen; the year is never stored or logged.
 */
export default function Account() {
  const { t } = useTranslation();
  const draft = useOnboarding();
  const detectedTz = useMemo(() => deviceTimeZone(), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tz, setTz] = useState(detectedTz ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const passwordRef = useRef<TextInput>(null);

  if (!draft.sawExpectations) return <Redirect href="/onboarding/expectations" />;
  if (draft.birthYear === null) return <Redirect href="/onboarding/age" />;

  const localErrors = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!EMAIL.test(email.trim())) e.email = t('field.emailInvalid');
    if (password.length < 10) e.password = t('field.passwordShort');
    else if (password.length > 256) e.password = t('field.passwordLong');
    else if (password.trim().toLowerCase() === email.trim().toLowerCase())
      e.password = t('field.passwordIsEmail');
    if (!tz.trim()) e.tz = t('field.required');
    return e;
  };

  async function submit() {
    setProblem(null);
    const e = localErrors();
    setFieldErrors(e);
    if (Object.keys(e).length || draft.birthYear === null) return;
    setBusy(true);
    try {
      const learner = await session.register({
        email: email.trim(),
        password,
        l1: draft.l1 ?? 'uz',
        birth_year: draft.birthYear,
        tz: tz.trim(),
        daily_goal_min: draft.dailyGoal,
        spelling_variant: draft.spellingVariant,
      });
      await useLearner.getState().load(learner.id);
      useLearner.getState().update((d) => ({
        ...d,
        startSection: draft.startSection,
        onboarding: {
          ...d.onboarding,
          why: draft.why,
          level: draft.level,
          plan: draft.plan
            ? { cue: draft.plan.cue, hour: draft.plan.hour, minute: draft.plan.minute }
            : null,
        },
      }));
      if (draft.plan?.remind) {
        const reminders = {
          ...usePrefs.getState().reminders,
          enabled: true,
          hour: draft.plan.hour,
          minute: draft.plan.minute,
          cue: draft.plan.cue,
        };
        usePrefs.getState().setReminders(reminders);
        const text = t('onboarding.plan.reminderText', {
          cue: t(`onboarding.plan.${draft.plan.cue}`),
        });
        void applyReminders(reminders, text, learner.is_minor).catch((err: unknown) =>
          log.warn('reminders.apply_failed', err),
        );
      }
      // The birth year has done its job; it leaves memory now.
      useOnboarding.getState().set({ birthYear: null, pendingFirstSentence: true });
    } catch (err) {
      const p = asProblem(err);
      if (p.type === 'age_requirement_not_met') {
        useOnboarding.getState().refuse();
        router.replace('/onboarding/not-yet');
        return;
      }
      const fe: Record<string, string> = {};
      for (const f of p.errors) {
        const field = f.field.replace(/^body\./, '');
        // Our copy where we know the field; the server's message otherwise. Never the value.
        fe[field] =
          field === 'email'
            ? t('field.emailInvalid')
            : field === 'password'
              ? // a common or breached password is refused with its reason (backend §14.5)
                p.type === 'password_refused'
                ? problemMessage(t, p)
                : t('field.passwordShort')
              : f.message;
      }
      setFieldErrors(fe);
      setProblem(p);
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingStep
      testID="onboarding-account"
      title={t('onboarding.account.title')}
      body={t('onboarding.account.body')}
      secondary={
        <Button size="lg" block busy={busy} onPress={() => void submit()} testID="register-submit">
          {busy ? t('onboarding.account.working') : t('onboarding.account.submit')}
        </Button>
      }
    >
      <View style={{ gap: 16 }}>
        <TextField
          label={t('field.email')}
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          testID="register-email"
        />
        <TextField
          ref={passwordRef}
          label={t('field.password')}
          value={password}
          onChangeText={setPassword}
          secure
          hint={t('field.passwordHint')}
          error={fieldErrors.password}
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          testID="register-password"
        />
        {detectedTz ? null : (
          <TextField
            label={t('me.timezone')}
            value={tz}
            onChangeText={setTz}
            error={fieldErrors.tz}
            autoCapitalize="none"
            placeholder="Asia/Tashkent"
            testID="register-tz"
          />
        )}
      </View>
      {problem?.type === 'email_taken' ? (
        <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
          <Notice icon="info">{t('errors.email_taken')}</Notice>
          <TextLink onPress={() => router.replace('/sign-in')}>
            {t('onboarding.account.emailTakenAction')}
          </TextLink>
          <RequestId id={problem.requestId} />
        </View>
      ) : problem ? (
        <ProblemNotice problem={problem} context="auth" testID="register-error" />
      ) : null}
      <TextLink onPress={() => router.replace('/sign-in')}>
        {t('onboarding.account.haveAccount')}
      </TextLink>
    </OnboardingStep>
  );
}
