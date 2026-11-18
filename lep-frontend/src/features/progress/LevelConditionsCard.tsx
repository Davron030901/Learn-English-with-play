import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { serverHasExam, serverHasWriting } from '@/api/queries/assessment';
import { useLevelConditions, type CefrBand } from '@/api/queries/gamification';
import type { ConditionOut } from '@/api/types';
import { Button, Card, Icon, Notice, SectionTitle, Txt, useTheme } from '@/design';

import { Appear } from './Appear';

const BANDS: readonly CefrBand[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** 'A1.2' → 'A1': the award is for the whole CEFR level, the path works in sub-levels. */
export function bandOf(cefr: string): CefrBand | null {
  const band = cefr.slice(0, 2).toUpperCase();
  return (BANDS as readonly string[]).includes(band) ? (band as CefrBand) : null;
}

const pct = (x: number) => Math.round(x * 100);

/**
 * docs/00 §7: a level is awarded when all four conditions hold — coverage of its syllabus,
 * retention of what was learned, the level exam, and writing and speaking at the level's band —
 * never by the path alone. Each row is the server's computed value against its threshold, said
 * in the learner's language (the server's own shortfall sentences are English and not shown).
 * A condition with nothing to measure yet says so; nothing is estimated on the device.
 */
export function LevelConditionsCard({ cefr }: { cefr: string }) {
  const { t } = useTranslation();
  const level = bandOf(cefr);
  const q = useLevelConditions(level);
  if (!level || !q.data) return null;
  const award = q.data;
  return (
    <Appear>
      <Card>
        <SectionTitle>{t('levelAward.title', { level })}</SectionTitle>
        {award.awarded ? (
          <Notice icon="medal" tone="green">
            {t('levelAward.awarded', { level })}
          </Notice>
        ) : (
          <Txt variant="body-s" color="ink-2">
            {t('levelAward.intro', { level })}
          </Txt>
        )}
        <View style={{ gap: 10 }} testID="level-conditions">
          {award.conditions.map((c) => (
            <ConditionRow key={c.name} condition={c} />
          ))}
        </View>
        {serverHasWriting && award.conditions.some((c) => c.name === 'production' && !c.passed) ? (
          <Button
            variant="secondary"
            icon="pencil"
            onPress={() => router.push({ pathname: '/writing/[level]', params: { level } })}
            testID="level-write"
          >
            {t('levelAward.write', { level })}
          </Button>
        ) : null}
        {serverHasExam && award.conditions.some((c) => c.name === 'exam' && !c.passed) ? (
          <Button
            variant="secondary"
            icon="medal"
            onPress={() => router.push({ pathname: '/exam/[level]', params: { level } })}
            testID="level-take-exam"
          >
            {t('levelAward.takeExam', { level })}
          </Button>
        ) : null}
        {award.message ? (
          <View testID="level-fragile">
            <Notice icon="info" tone="orange">
              {t('levelAward.fragile')}
            </Notice>
          </View>
        ) : null}
      </Card>
    </Appear>
  );
}

function ConditionRow({ condition: c }: { condition: ConditionOut }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const detail = (() => {
    switch (c.name) {
      case 'coverage':
        return t('levelAward.coverage', { value: pct(c.value ?? 0), need: pct(c.threshold) });
      case 'retention':
        return t('levelAward.retention', { value: pct(c.value ?? 0), need: pct(c.threshold) });
      case 'exam':
        return c.value === null
          ? t('levelAward.examNotTaken', { need: pct(c.threshold) })
          : t('levelAward.exam', { value: pct(c.value), need: pct(c.threshold) });
      case 'production':
        return c.value === null
          ? t('levelAward.productionNone', { need: c.threshold })
          : t('levelAward.production', { value: c.value, need: c.threshold });
    }
  })();
  const status = c.passed ? t('levelAward.met') : t('levelAward.notYet');
  return (
    <View
      style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}
      accessible
      accessibilityLabel={`${t(`levelAward.name.${c.name}`)}: ${status}. ${detail}`}
      testID={`level-condition-${c.name}`}
    >
      <Icon
        name={c.passed ? 'check-circle' : 'target'}
        size={22}
        color={c.passed ? theme.c['success-ink'] : theme.c['ink-3']}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body-m" weight={800}>
          {t(`levelAward.name.${c.name}`)}
        </Txt>
        <Txt variant="body-s" color="ink-2">
          {detail}
        </Txt>
      </View>
    </View>
  );
}
