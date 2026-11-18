import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { CefrBand } from '@/api/queries/gamification';
import { useCourse, useWords } from '@/content/queries';
import { Button, Mascot, Screen, ScreenHeader, Txt } from '@/design';
import { LevelExam } from '@/features/assessment/LevelExam';
import { ProblemNotice, asProblem } from '@/features/errors';
import { bandOf } from '@/features/progress/LevelConditionsCard';

function done() {
  if (router.canGoBack()) router.back();
  else router.replace('/progress');
}

/** /exam/:level — the level exam, one of the four conditions of a level award (docs/12 §4). */
export default function ExamRoute() {
  const { t } = useTranslation();
  const { level: raw = '' } = useLocalSearchParams<{ level: string }>();
  const level: CefrBand | null = raw.length === 2 ? bandOf(raw) : null;
  const course = useCourse();
  const words = useWords();
  const header = (
    <ScreenHeader
      title={t('exam.title', { level: level ?? raw })}
      onBack={done}
      backLabel={t('common.back')}
    />
  );
  const error = course.error ?? words.error;
  if (error) {
    return (
      <Screen header={header}>
        <ProblemNotice problem={asProblem(error)} onRetry={() => void course.refetch()} />
      </Screen>
    );
  }
  if (!level) {
    return (
      <Screen header={header} testID="exam-not-found">
        <Mascot pose="think" size={120} />
        <Txt variant="title-m">{t('errors.not_found')}</Txt>
        <Button onPress={done}>{t('common.back')}</Button>
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
  return <LevelExam level={level} course={course.data} words={words.data} onDone={done} />;
}
