import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { BadgeOut } from '@/api/types';
import type { Course } from '@/content/model';
import { Card, Chip, SectionTitle, Txt, levelTone, tone, useTheme } from '@/design';
import { usePrefs } from '@/state/prefs';

import { formatDate } from './serverState';

/** A stamp: the unit's level colour, a dashed inner ring and a star — inked, not a trophy. */
function Stamp({ cefr }: { cefr: string }) {
  const theme = useTheme();
  const c = tone(theme, levelTone(cefr));
  return (
    <Svg width={40} height={40} viewBox="0 0 40 40">
      <Circle cx={20} cy={20} r={17} fill={c.soft} stroke={c.c} strokeWidth={2.5} />
      <Circle cx={20} cy={20} r={12.5} fill="none" stroke={c.c} strokeWidth={1} strokeDasharray="2 2" />
      <Path d="M20 12.5 L22.2 17.2 L27.3 17.8 L23.5 21.3 L24.6 26.4 L20 23.8 L15.4 26.4 L16.5 21.3 L12.7 17.8 L17.8 17.2 Z" fill={c.ink} />
    </Svg>
  );
}

const StampRow = memo(function StampRow({ badge, cefr, isNew, date }: { badge: BadgeOut; cefr: string; isNew: boolean; date: string }) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }} testID={`stamp-${badge.id}`}>
      <Stamp cefr={cefr} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt variant="learn-s" lang="en" style={{ fontSize: 16, lineHeight: 22 }}>
          {badge.text}
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <Txt variant="caption" color="ink-3">
            {t('progressScreen.passportEarned', { date })}
          </Txt>
          {isNew ? (
            <Chip size="sm" tone="xp">
              {t('progressScreen.passportNew')}
            </Chip>
          ) : null}
        </View>
      </View>
    </View>
  );
});

/**
 * The English Passport (docs/16 E11): badges are the units' CEFR can-do statements, grouped by
 * unit — capabilities the learner demonstrated, never activity counts. Earned stamps only come
 * from the server; the total is a course fact (three can-dos per unit).
 */
export function Passport({ badges, unseen, course }: { badges: readonly BadgeOut[]; unseen?: readonly BadgeOut[]; course: Course | undefined }) {
  const { t } = useTranslation();
  const language = usePrefs((s) => s.interfaceLanguage);
  const unseenIds = useMemo(() => new Set((unseen ?? []).map((b) => b.id)), [unseen]);
  const groups = useMemo(() => {
    const by = new Map<string, BadgeOut[]>();
    for (const b of badges) by.set(b.unit_id, [...(by.get(b.unit_id) ?? []), b]);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([unitId, list]) => ({ unitId, list: [...list].sort((x, y) => x.id.localeCompare(y.id)) }));
  }, [badges]);
  const total = useMemo(() => course?.sections.reduce((n, s) => n + s.units.reduce((m, u) => m + u.canDo.length, 0), 0) ?? 0, [course]);

  return (
    <Card>
      <SectionTitle>{t('progressScreen.passportTitle')}</SectionTitle>
      {total > 0 ? (
        <Txt variant="body-s" color="ink-2" testID="passport-count">
          {t('progressScreen.passportCount', { count: badges.length, total })}
        </Txt>
      ) : null}
      {groups.length === 0 ? (
        <Txt variant="body-m" color="ink-2">
          {t('progressScreen.passportEmpty')}
        </Txt>
      ) : (
        groups.map(({ unitId, list }) => {
          const outline = course?.unitsById.get(unitId);
          const title = outline ? (outline.title[language] ?? outline.title.en) : unitId;
          const cefr = outline?.cefr ?? 'A1';
          return (
            <View key={unitId} style={{ gap: 10 }} testID={`passport-${unitId}`}>
              <Txt variant="overline" color="ink-3" accessibilityRole="header">
                {outline ? t('progressScreen.passportUnit', { n: outline.index, title }) : title}
              </Txt>
              {list.map((b) => (
                <StampRow key={b.id} badge={b} cefr={cefr} isNew={unseenIds.has(b.id)} date={formatDate(b.awarded_at, language)} />
              ))}
            </View>
          );
        })
      )}
    </Card>
  );
}
