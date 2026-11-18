import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useCourse, useWords } from '@/content/queries';
import { Button, Mascot, Screen, ScreenHeader, Txt } from '@/design';
import { TestOut } from '@/features/assessment/TestOut';
import { ProblemNotice, asProblem } from '@/features/errors';

function done() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** /test-out/:unitId — skip a unit by passing its test (docs/16 E14). */
export default function TestOutRoute() {
  const { t } = useTranslation();
  const { unitId = '' } = useLocalSearchParams<{ unitId: string }>();
  const course = useCourse();
  const words = useWords();
  const outline = course.data?.unitsById.get(unitId);
  const header = <ScreenHeader title={t('testOut.title')} onBack={done} backLabel={t('common.back')} />;
  const error = course.error ?? words.error;
  if (error) {
    return (
      <Screen header={header}>
        <ProblemNotice problem={asProblem(error)} onRetry={() => void course.refetch()} />
      </Screen>
    );
  }
  if (course.data && !outline) {
    return (
      <Screen header={header} testID="testout-not-found">
        <Mascot pose="think" size={120} />
        <Txt variant="title-m">{t('errors.not_found')}</Txt>
        <Button onPress={done}>{t('common.back')}</Button>
      </Screen>
    );
  }
  if (!course.data || !outline || !words.data) {
    return (
      <Screen header={header}>
        <Txt color="ink-3">{t('common.loading')}</Txt>
      </Screen>
    );
  }
  return <TestOut outline={outline} course={course.data} words={words.data} onDone={done} />;
}
