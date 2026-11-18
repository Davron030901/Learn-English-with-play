import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCourse, useLexicon, useUnit } from '@/content/queries';
import { Button, Mascot, Screen, ScreenHeader, Txt } from '@/design';
import { ProblemNotice, asProblem } from '@/features/errors';
import { StoryReader, unitOfStory } from '@/features/story/StoryReader';

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/library');
}

/** /story/:textId — one episode of the course's serial story. */
export default function StoryRoute() {
  const { t } = useTranslation();
  const { textId = '' } = useLocalSearchParams<{ textId: string }>();
  const course = useCourse();
  const outline = useMemo(() => (course.data ? unitOfStory(course.data, textId) : null), [course.data, textId]);
  const unit = useUnit(outline?.id);
  // The tap-gloss index is ~1 MB; the script renders first and words become tappable when it lands.
  const lexicon = useLexicon(!!outline);

  const header = <ScreenHeader title={t('story.title')} onBack={back} backLabel={t('common.back')} />;
  const error = course.error ?? unit.error;
  if (error) {
    return (
      <Screen header={header}>
        <ProblemNotice
          problem={asProblem(error)}
          onRetry={() => {
            void course.refetch();
            void unit.refetch();
          }}
        />
      </Screen>
    );
  }
  if (course.data && !outline) {
    return (
      <Screen header={header} testID="story-not-found">
        <Mascot pose="think" size={120} />
        <Txt variant="title-m">{t('story.notFound')}</Txt>
        <Button onPress={back}>{t('common.back')}</Button>
      </Screen>
    );
  }
  if (!course.data || !outline || !unit.data) {
    return (
      <Screen header={header}>
        <Txt color="ink-3">{t('common.loading')}</Txt>
      </Screen>
    );
  }
  return (
    <Screen header={header}>
      <StoryReader unit={unit.data} outline={outline} course={course.data} lexicon={lexicon.data} />
    </Screen>
  );
}
