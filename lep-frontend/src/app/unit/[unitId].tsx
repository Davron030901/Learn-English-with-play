import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useCourse, useUnit } from '@/content/queries';
import { serverHasAssessment } from '@/api/queries/assessment';
import { Button, ListRow, Card, Mascot, Screen, ScreenHeader, Txt } from '@/design';
import { ProblemNotice, asProblem } from '@/features/errors';
import { UnitNotes } from '@/features/unit/UnitNotes';

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** /unit/:unitId — the unit's notes. */
export default function UnitRoute() {
  const { t } = useTranslation();
  const { unitId = '' } = useLocalSearchParams<{ unitId: string }>();
  const course = useCourse();
  const outline = course.data?.unitsById.get(unitId);
  const unit = useUnit(outline ? unitId : undefined);
  const header = <ScreenHeader title={outline ? outline.title.en : ''} onBack={back} backLabel={t('common.back')} />;

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
      <Screen header={header} testID="unit-not-found">
        <Mascot pose="think" size={120} />
        <Txt variant="title-m">{t('errors.not_found')}</Txt>
        <Button onPress={back}>{t('common.back')}</Button>
      </Screen>
    );
  }
  if (!outline || !unit.data) {
    return (
      <Screen header={header}>
        <Txt color="ink-3">{t('common.loading')}</Txt>
      </Screen>
    );
  }
  return (
    <Screen header={header}>
      {serverHasAssessment ? (
        <Card padded={false}>
          <ListRow
            icon="flag"
            tone="purple"
            title={t('testOut.offer')}
            sub={t('testOut.offerBody')}
            chevron
            onPress={() => router.push({ pathname: '/test-out/[unitId]', params: { unitId } })}
            testID="unit-test-out"
          />
        </Card>
      ) : null}
      <UnitNotes unit={unit.data} outline={outline} />
    </Screen>
  );
}
