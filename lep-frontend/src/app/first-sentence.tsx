import { router } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useCourse, useUnit, useWords } from '@/content/queries';
import { Screen, Txt } from '@/design';
import { ProblemNotice, asProblem } from '@/features/errors';
import { FirstSentence } from '@/features/onboarding/FirstSentence';
import { useOnboarding } from '@/state/onboarding';

/** /first-sentence — onboarding step 8, shown once, right after the account is created. */
export default function FirstSentenceRoute() {
  const { t } = useTranslation();
  const course = useCourse();
  const unit = useUnit('S01U01');
  const words = useWords();

  const done = useCallback(() => {
    useOnboarding.getState().reset();
    router.replace('/');
  }, []);

  const error = course.error ?? unit.error ?? words.error;
  if (error) {
    return (
      <Screen>
        <ProblemNotice problem={asProblem(error)} onRetry={() => void unit.refetch()} />
      </Screen>
    );
  }
  if (!course.data || !unit.data || !words.data) {
    return (
      <Screen>
        <Txt color="ink-3">{t('common.loading')}</Txt>
      </Screen>
    );
  }
  return (
    <Screen>
      <FirstSentence unit={unit.data} instructions={course.data.instructions} words={words.data} onDone={done} />
    </Screen>
  );
}
