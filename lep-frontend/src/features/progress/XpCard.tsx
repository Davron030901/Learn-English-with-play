import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { GamificationSummary } from '@/api/types';
import { Card, Icon, SectionTitle, Txt, radius, useTheme } from '@/design';
import { usePrefs } from '@/state/prefs';

import { formatNumber } from './serverState';

/** XP last (docs/10 §4.1), with what it measures — the server's ledger, never a device sum. */
export function XpCard({ summary }: { summary: Pick<GamificationSummary, 'xp_today' | 'xp_week' | 'xp_total'> }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = usePrefs((s) => s.interfaceLanguage);
  const tiles = [
    { key: 'today', label: t('progressScreen.xpToday'), value: summary.xp_today },
    { key: 'week', label: t('progressScreen.xpWeek'), value: summary.xp_week },
    { key: 'total', label: t('progressScreen.xpTotal'), value: summary.xp_total },
  ];
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="bolt" tone="color" size={24} />
        <SectionTitle>{t('progressScreen.xpTitle')}</SectionTitle>
      </View>
      <View
        accessible
        accessibilityLabel={t('progressScreen.xpA11y', { today: summary.xp_today, week: summary.xp_week, total: summary.xp_total })}
        style={{ flexDirection: 'row', gap: 8 }}
        testID="xp"
      >
        {tiles.map((x) => (
          <View key={x.key} style={{ flex: 1, minWidth: 0, gap: 2, paddingVertical: 10, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: theme.c['xp-soft'] }}>
            <Txt variant="stat-s" numberOfLines={1} adjustsFontSizeToFit rawColor={theme.c['xp-ink']}>
              {formatNumber(x.value, language)}
            </Txt>
            <Txt variant="caption" color="ink-2" numberOfLines={1}>
              {x.label}
            </Txt>
          </View>
        ))}
      </View>
      <Txt variant="caption" color="ink-3">
        {t('progressScreen.xpNote')}
      </Txt>
    </Card>
  );
}
