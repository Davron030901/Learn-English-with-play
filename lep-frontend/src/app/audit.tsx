import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useCourse, useWords } from '@/content/queries';
import { Screen, ScreenHeader, Txt } from '@/design';
import { RetentionCheck } from '@/features/assessment/RetentionCheck';
import { ProblemNotice, asProblem } from '@/features/errors';

function done() {
  if (router.canGoBack()) router.back();
  else router.replace('/progress');
}

/** /audit — the monthly memory check (docs/08 §9). */
export default function AuditRoute() {
  const { t } = useTranslation();
  const course = useCourse();
  const words = useWords();
  const header = (
    <ScreenHeader title={t('audit.title')} onBack={done} backLabel={t('common.back')} />
  );
  const error = course.error ?? words.error;
  if (error) {
    return (
      <Screen header={header}>
        <ProblemNotice problem={asProblem(error)} onRetry={() => void course.refetch()} />
      </Screen>
    );
  }
  if (!course.data || !words.data) {
    return (
      <Screen header={header}>
        <Txt color="ink-3">{t('common.loading')}</Txt>
      </Screen>
    );
  }
  return <RetentionCheck course={course.data} words={words.data} onDone={done} />;
}
