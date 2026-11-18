import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useCourse, useWords } from '@/content/queries';
import { Screen, ScreenHeader, Txt } from '@/design';
import { Placement } from '@/features/assessment/Placement';
import { ProblemNotice, asProblem } from '@/features/errors';

function done() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** /placement — "Find your level" (docs/16 E20). */
export default function PlacementRoute() {
  const { t } = useTranslation();
  const course = useCourse();
  const words = useWords();
  const error = course.error ?? words.error;
  if (!course.data || !words.data) {
    return (
      <Screen header={<ScreenHeader title={t('placementCheck.title')} onBack={done} backLabel={t('common.back')} />}>
        {error ? <ProblemNotice problem={asProblem(error)} onRetry={() => void course.refetch()} /> : <Txt color="ink-3">{t('common.loading')}</Txt>}
      </Screen>
    );
  }
  return <Placement course={course.data} words={words.data} onDone={done} />;
}
