import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from './Button';
import { Chip, LevelBadge } from './Bits';
import { AudioButton } from './Exercise';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { tone, useTheme, type Tone } from './theme';
import { radius } from './tokens.generated';

/**
 * Cumulative guided + self-directed hours to reach each CEFR level, as the design system's
 * HonestTimeline draws them (≈1,200 hours to C2). These are course facts, the same for every
 * learner — not a statistic about the learner (brief §8.4 guardrail 9 does not apply).
 */
export const HOURS_TO_LEVEL = [
  ['A1', 100],
  ['A2', 200],
  ['B1', 400],
  ['B2', 600],
  ['C1', 800],
  ['C2', 1200],
] as const;

export function yearsToLevel(hours: number, minutesPerDay: number): number {
  return hours / ((minutesPerDay / 60) * 365);
}

/** Years to reach each CEFR level at one or two daily-time settings. */
export function HonestTimeline({ minutes, size = 'md', note }: { minutes: number[]; size?: 'md' | 'lg'; note?: string | null }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const mins = minutes.filter((m) => m > 0).slice(0, 2);
  const colours = [theme.c['chart-1'], theme.c['chart-2']];
  const max = Math.max(...mins.map((m) => yearsToLevel(1200, m)));
  const fmt = (y: number) =>
    y < 1 ? t('timeline.months', { count: Math.max(1, Math.round(y * 12)) }) : t('timeline.years', { count: (Math.round(y * 10) / 10).toFixed(1) });
  const lg = size === 'lg';
  const summary = HOURS_TO_LEVEL.map(([lvl, hrs]) => `${t('timeline.levelHours', { level: lvl, hours: hrs.toLocaleString('en-US') })}: ${mins.map((m) => `${t('timeline.perDay', { minutes: m })} ${fmt(yearsToLevel(hrs, m))}`).join(', ')}`).join('. ');
  return (
    <View style={{ gap: 10 }} accessible accessibilityRole="image" accessibilityLabel={`${t('timeline.caption')}. ${summary}`}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        {mins.map((m, i) => (
          <View key={m} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: colours[i] }} />
            <Txt variant="caption" weight={800} color="ink-2">
              {t('timeline.perDay', { minutes: m })}
            </Txt>
          </View>
        ))}
      </View>
      <View style={{ gap: lg ? 16 : 10 }}>
        {HOURS_TO_LEVEL.map(([lvl, hrs]) => (
          <View key={lvl} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Txt variant="body-s" weight={900} style={{ width: lg ? 52 : 38, fontSize: lg ? 17 : 14 }}>
              {lvl}
            </Txt>
            <View style={{ flex: 1, gap: 2 }}>
              {mins.map((m, i) => {
                const y = yearsToLevel(hrs, m);
                return (
                  <View key={m} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: lg ? 18 : 12 }}>
                    <View style={{ flexGrow: 0, flexShrink: 1, flexBasis: `${Math.max(1, (y / max) * 78)}%`, height: lg ? 18 : 12, borderTopEndRadius: 4, borderBottomEndRadius: 4, backgroundColor: colours[i], minWidth: 3 }} />
                    <Txt variant="caption" weight={800} color="ink-2" style={{ fontSize: lg ? 14 : 12, lineHeight: lg ? 18 : 12 }}>
                      {fmt(y)}
                    </Txt>
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </View>
      {note !== null ? (
        <Txt variant="caption" color="ink-3">
          {note ?? t('progress.timelineNote')}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * The honest headline number. Rendered only with a value the server computed; until then the
 * Progress screen shows `Pending` instead (brief §0 rule 8: showing nothing beats a guess).
 */
export function CoverageMeter({ value, of, target = 95 }: { value: number; of: string; target?: number }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <Txt variant="stat-xl">{`~${value}%`}</Txt>
        <Txt variant="body-l" weight={700} color="ink-2">
          {of}
        </Txt>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: value }}
        style={{ height: 16, borderRadius: radius.full, backgroundColor: theme.c['primary-soft'] }}
      >
        <View style={{ width: `${value}%`, height: 16, borderRadius: radius.full, backgroundColor: theme.c.primary }} />
        <View style={{ position: 'absolute', top: -5, bottom: -5, width: 3, start: `${target}%`, marginStart: -1.5, borderRadius: 2, backgroundColor: theme.c.ink }} />
      </View>
    </View>
  );
}

/** A progress block whose figure is computed by the server and is not available yet. */
export function PendingStat({
  icon,
  tone: tn = 'primary',
  title,
  body,
  level,
}: {
  icon: IconName;
  tone?: Tone;
  title: string;
  body: string;
  level?: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const c = tone(theme, tn);
  return (
    <View style={{ gap: 10, padding: 16, borderRadius: radius.lg, backgroundColor: theme.c.surface, borderWidth: 2, borderColor: theme.c.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={18} color={c.ink} />
        </View>
        <Txt variant="title-s" style={{ flex: 1 }}>
          {title}
        </Txt>
        {level ? <LevelBadge level={level} size="sm" /> : null}
      </View>
      <Chip icon="clock" size="sm">
        {t('common.notAvailableYet')}
      </Chip>
      <Txt variant="body-s" color="ink-2">
        {body}
      </Txt>
    </View>
  );
}

export function GlossCard({
  word,
  ipa,
  pos,
  gloss,
  glossLang,
  example,
  onHear,
  hearLabel,
  footer,
  saveLabel,
  onSave,
  saved,
}: {
  word: string;
  ipa?: string;
  pos?: string;
  gloss?: string | null;
  glossLang?: string;
  example?: string | null;
  onHear?: () => void;
  hearLabel?: string;
  footer?: ReactNode;
  saveLabel?: string;
  onSave?: () => void;
  saved?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="summary"
      style={{ gap: 10, padding: 16, borderRadius: radius.lg, backgroundColor: theme.c.surface, borderWidth: 2, borderColor: theme.c['line-2'], boxShadow: theme.floatShadow }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Txt variant="learn-l" weight={700} lang="en" style={{ flex: 1, fontSize: 26, lineHeight: 32 }}>
          {word}
        </Txt>
        {onHear ? <AudioButton size="sm" onPress={onHear} label={hearLabel ?? word} /> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {ipa ? (
          <Txt variant="ipa" color="ink-3" accessibilityLabel={`${word}, pronunciation ${ipa}`}>
            {`/${ipa}/`}
          </Txt>
        ) : null}
        {pos ? <Chip size="sm">{pos}</Chip> : null}
      </View>
      {gloss ? (
        <Txt variant="title-s" weight={800} lang={glossLang}>
          {gloss}
        </Txt>
      ) : null}
      {example ? (
        <Txt variant="learn-s" color="ink-2" lang="en" style={{ fontSize: 16, lineHeight: 23 }}>
          {example}
        </Txt>
      ) : null}
      {onSave && saveLabel ? (
        <Button variant="secondary" size="sm" icon={saved ? 'check' : 'plus'} onPress={onSave} disabled={saved}>
          {saveLabel}
        </Button>
      ) : null}
      {footer}
    </View>
  );
}
