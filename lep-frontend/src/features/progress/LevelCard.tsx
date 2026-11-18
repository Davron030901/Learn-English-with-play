import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ProgressOut } from '@/api/types';
import { Card, LevelBadge, ProgressBar, SectionTitle, Txt, levelTone } from '@/design';

/** Level second (docs/10 §4.1): the sub-level of the current unit and how far through it the path is. */
export function LevelCard({ level }: { level: ProgressOut['level'] }) {
  const { t } = useTranslation();
  const label = t('progressScreen.levelA11y', { level: level.cefr, done: level.units_done, total: level.units_total });
  return (
    <Card>
      <SectionTitle>{t('progress.levelTitle')}</SectionTitle>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} testID="level">
        <LevelBadge level={level.cefr} size="lg" label={label} />
        <View style={{ flex: 1, gap: 8 }}>
          <Txt variant="body-m" weight={800}>
            {t('progressScreen.levelUnits', { done: level.units_done, total: level.units_total, level: level.cefr })}
          </Txt>
          <View style={{ flexDirection: 'row' }}>
            <ProgressBar value={level.units_done} max={Math.max(1, level.units_total)} tone={levelTone(level.cefr)} size="md" label={label} />
          </View>
        </View>
      </View>
      <Txt variant="caption" color="ink-3">
        {t('progressScreen.levelNote', { level: level.cefr })}
      </Txt>
    </Card>
  );
}
