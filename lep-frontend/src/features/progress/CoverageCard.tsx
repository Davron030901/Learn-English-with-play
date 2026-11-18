import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { serverHasAudit } from '@/api/queries/assessment';
import type { ProgressOut } from '@/api/types';
import { Card, Chip, CoverageMeter, SectionTitle, TextLink, Txt } from '@/design';

import { roundPercent } from './serverState';

/**
 * The headline (docs/10 §4.1): how much everyday English the learner's known words cover. A word
 * is known when its weakest exercised side is retained — the server's rule, explained here — and
 * the share stays labelled an estimate until a retention audit has checked it (docs/08 §9).
 */
export function CoverageCard({ coverage }: { coverage: ProgressOut['coverage'] }) {
  const { t } = useTranslation();
  const [explain, setExplain] = useState(false);
  const percent = roundPercent(coverage.estimate_percent);
  const note = coverage.audited
    ? t('progressScreen.auditedNote')
    : t('progressScreen.estimateNote');
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <SectionTitle>{t('progress.coverageTitle')}</SectionTitle>
        </View>
        <Chip
          size="sm"
          icon={coverage.audited ? 'check' : 'info'}
          tone={coverage.audited ? 'success' : undefined}
        >
          {coverage.audited ? t('progressScreen.auditedChip') : t('progressScreen.estimateChip')}
        </Chip>
      </View>
      <View
        accessible
        accessibilityLabel={t('progressScreen.coverageA11y', {
          count: coverage.known_lexemes,
          percent,
          note,
        })}
        style={{ gap: 10 }}
        testID="coverage"
      >
        <Txt variant="title-m" testID="coverage-known">
          {t('progressScreen.knownWords', { count: coverage.known_lexemes })}
        </Txt>
        <CoverageMeter value={percent} of={t('progressScreen.ofEveryday')} />
      </View>
      {coverage.learning_lexemes > 0 ? (
        <Txt variant="body-s" color="ink-2">
          {t('progressScreen.learningWords', { count: coverage.learning_lexemes })}
        </Txt>
      ) : null}
      <Txt variant="caption" color="ink-3">
        {note}
      </Txt>
      {serverHasAudit ? (
        <TextLink
          icon="target"
          onPress={() => router.push('/audit')}
          testID="coverage-check-memory"
        >
          {t('progressScreen.checkMemory')}
        </TextLink>
      ) : null}
      <TextLink icon="info" onPress={() => setExplain((v) => !v)} testID="coverage-explain">
        {t('progressScreen.whatCounts')}
      </TextLink>
      {explain ? (
        <Txt variant="body-s" color="ink-2" accessibilityLiveRegion="polite">
          {t('progressScreen.knownExplain')}
        </Txt>
      ) : null}
    </Card>
  );
}
