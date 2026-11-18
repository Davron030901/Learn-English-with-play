import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type TextInput } from 'react-native';

import { serverHasPasswordChange, useChangePassword } from '@/api/queries/account';
import { Button, Card, Notice, SectionTitle, TextField, Txt } from '@/design';
import { asProblem, ProblemNotice, problemMessage } from '@/features/errors';
import { isOnline, useOnlineStore } from '@/state/online';

const MIN_LENGTH = 10;

/**
 * Change the password while signed in (POST /v1/me/password, backend DECISIONS §14.3): the
 * current one first; the server refuses common, breached and email-shaped passwords and says
 * why (a reason slug, shown in the learner's language); other devices are signed out, this one
 * stays. Nothing typed here is kept once it succeeds.
 */
export function ChangePassword() {
  const { t } = useTranslation();
  const online = useOnlineStore(isOnline);
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string }>({});
  const [done, setDone] = useState(false);
  const nextRef = useRef<TextInput>(null);

  if (!serverHasPasswordChange) return null;

  const submit = () => {
    setDone(false);
    const local: { current?: string; next?: string } = {};
    if (!current) local.current = t('password.currentNeeded');
    if (next.length < MIN_LENGTH) local.next = t('field.passwordShort');
    setErrors(local);
    if (local.current || local.next) return;
    change.mutate(
      { current, next },
      {
        onSuccess: () => {
          setCurrent('');
          setNext('');
          setErrors({});
          setDone(true);
        },
        onError: (e) => {
          const p = asProblem(e);
          const field = p.errors[0]?.field.replace(/^body\./, '');
          if (field === 'current_password') setErrors({ current: t('password.wrongCurrent') });
          else if (p.type === 'password_refused') setErrors({ next: problemMessage(t, p) });
          else setErrors({});
        },
      },
    );
  };

  const problem = change.error ? asProblem(change.error) : null;
  const shownOnField =
    problem && (problem.type === 'password_refused' || problem.type === 'validation_error');

  return (
    <View testID="change-password">
      <Card>
        <SectionTitle>{t('password.title')}</SectionTitle>
        <Txt variant="body-s" color="ink-2">
          {t('password.hint')}
        </Txt>
        <View style={{ gap: 12 }}>
          <TextField
            label={t('password.current')}
            value={current}
            onChangeText={setCurrent}
            error={errors.current ?? null}
            secure
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="next"
            onSubmitEditing={() => nextRef.current?.focus()}
            testID="password-current"
          />
          <TextField
            ref={nextRef}
            label={t('password.next')}
            value={next}
            onChangeText={setNext}
            error={errors.next ?? null}
            secure
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={submit}
            testID="password-next"
          />
        </View>
        {problem && !shownOnField ? <ProblemNotice problem={problem} /> : null}
        {done ? (
          <View testID="password-changed">
            <Notice icon="check" tone="green">
              {t('password.done')}
            </Notice>
          </View>
        ) : null}
        <Button
          block
          busy={change.isPending}
          disabled={!online}
          onPress={submit}
          testID="password-submit"
        >
          {change.isPending ? t('password.working') : t('password.submit')}
        </Button>
      </Card>
    </View>
  );
}
