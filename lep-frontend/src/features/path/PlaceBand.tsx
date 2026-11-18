import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import { LevelBadge, Txt, levelTone, radius, tone, useTheme, type Theme } from '@/design';
import type { ToneColors } from '@/design/theme';

/**
 * The section's place (docs/16 E08 §4): a light scene band — a handful of SVG primitives per
 * place, drawn in the section's level colours and the theme's tokens (so the dark theme gets an
 * evening version for free) — with the section and the place name over it. Decorative: the
 * picture is hidden from screen readers; the words carry the meaning.
 */

type Draw = (p: { t: ToneColors; theme: Theme }) => ReactElement;

const GROUND = 104;

const windows = (x: number, y: number, cols: number, rows: number, fill: string, gap = 9) =>
  Array.from({ length: cols * rows }, (_, i) => <Rect key={`w${x}-${i}`} x={x + (i % cols) * gap} y={y + Math.floor(i / cols) * gap} width={4} height={5} rx={1} fill={fill} />);

const SCENES: Record<number, Draw> = {
  // 1 Mahalla courtyard: a vine trellis, two houses, a pomegranate tree, the sun.
  1: ({ t, theme }) => (
    <G>
      <Circle cx={300} cy={30} r={14} fill={theme.c.yellow} />
      <Path d={`M150 ${GROUND} V58 M190 ${GROUND} V58 M230 ${GROUND} V58 M140 58 H240`} stroke={t.lip} strokeWidth={4} strokeLinecap="round" />
      <Path d="M140 58 q12 -10 24 0 q12 -10 24 0 q12 -10 24 0 q12 -10 24 0" stroke={theme.c.green} strokeWidth={6} fill="none" strokeLinecap="round" />
      <Rect x={250} y={66} width={60} height={38} fill={t.c} opacity={0.75} />
      <Path d="M244 68 L280 46 L316 68 Z" fill={t.lip} />
      <Rect x={274} y={84} width={12} height={20} fill={t.soft} />
      <Rect x={84} y={74} width={6} height={30} fill={t.lip} />
      <Circle cx={87} cy={64} r={20} fill={theme.c.green} opacity={0.9} />
      <Circle cx={79} cy={60} r={3.5} fill={theme.c.red} />
      <Circle cx={95} cy={68} r={3.5} fill={theme.c.red} />
      <Circle cx={88} cy={54} r={3.5} fill={theme.c.red} />
    </G>
  ),
  // 2 City streets and metro: blocks with windows, a plane tree, the metro "M".
  2: ({ t, theme }) => (
    <G>
      <Rect x={190} y={34} width={46} height={70} fill={t.c} opacity={0.55} />
      <Rect x={240} y={50} width={40} height={54} fill={t.c} opacity={0.8} />
      <Rect x={286} y={26} width={44} height={78} fill={t.c} opacity={0.6} />
      {windows(196, 42, 4, 6, t.soft)}
      {windows(246, 58, 4, 4, t.soft)}
      {windows(292, 34, 4, 7, t.soft)}
      <Rect x={112} y={70} width={6} height={34} fill={t.lip} />
      <Ellipse cx={115} cy={60} rx={24} ry={20} fill={theme.c.green} />
      <Circle cx={60} cy={62} r={16} fill={theme.c.red} />
      <Path d="M51 70 V55 L60 64 L69 55 V70" stroke={theme.c.white} strokeWidth={3} fill="none" strokeLinejoin="round" />
      <Rect x={58} y={78} width={4} height={26} fill={t.lip} />
    </G>
  ),
  // 3 On the road: mountains, a viaduct, a train.
  3: ({ t, theme }) => (
    <G>
      <Path d="M150 104 L210 40 L250 80 L290 30 L350 104 Z" fill={t.c} opacity={0.45} />
      <Path d="M276 46 L290 30 L304 46 Z" fill={theme.c.white} />
      <Path d="M20 84 H340" stroke={t.lip} strokeWidth={5} />
      {[40, 90, 140, 190, 240, 290].map((x) => (
        <Path key={x} d={`M${x} 104 V92 a14 10 0 0 1 28 0 V104`} stroke={t.lip} strokeWidth={3} fill="none" />
      ))}
      <Rect x={70} y={64} width={46} height={18} rx={5} fill={t.c} />
      <Rect x={120} y={64} width={46} height={18} rx={5} fill={t.c} />
      <Rect x={170} y={66} width={30} height={16} rx={8} fill={theme.c.yellow} />
      {windows(76, 68, 4, 1, theme.c.white, 10)}
      {windows(126, 68, 4, 1, theme.c.white, 10)}
    </G>
  ),
  // 4 Samarkand's blue domes: three ribbed domes on drums, two minarets.
  4: ({ t, theme }) => (
    <G>
      <Rect x={60} y={30} width={14} height={74} fill={t.lip} />
      <Rect x={286} y={30} width={14} height={74} fill={t.lip} />
      <Rect x={56} y={26} width={22} height={6} fill={theme.c.lagoon} />
      <Rect x={282} y={26} width={22} height={6} fill={theme.c.lagoon} />
      {[
        { x: 130, w: 46, top: 52 },
        { x: 180, w: 60, top: 36 },
        { x: 244, w: 46, top: 52 },
      ].map((d) => (
        <G key={d.x}>
          <Rect x={d.x - d.w / 2 + 4} y={d.top + d.w / 2 - 2} width={d.w - 8} height={GROUND - (d.top + d.w / 2 - 2)} fill={t.c} opacity={0.8} />
          <Path d={`M${d.x - d.w / 2} ${d.top + d.w / 2} a${d.w / 2} ${d.w / 2} 0 0 1 ${d.w} 0 Z`} fill={theme.c.lagoon} />
          <Path d={`M${d.x} ${d.top} V${d.top + d.w / 2} M${d.x - d.w / 4} ${d.top + 6} V${d.top + d.w / 2} M${d.x + d.w / 4} ${d.top + 6} V${d.top + d.w / 2}`} stroke={theme.c['lagoon-lip']} strokeWidth={1.5} />
        </G>
      ))}
      <Path d="M80 96 H280" stroke={theme.c.lagoon} strokeWidth={4} strokeDasharray="6 4" />
    </G>
  ),
  // 5 Bazaar and choyxona: a striped awning, a melon pyramid, round non bread.
  5: ({ t, theme }) => (
    <G>
      {Array.from({ length: 8 }, (_, i) => (
        <Rect key={i} x={170 + i * 20} y={36} width={20} height={18} fill={i % 2 ? t.c : theme.c.white} />
      ))}
      <Path d="M170 54 q10 8 20 0 q10 8 20 0 q10 8 20 0 q10 8 20 0 q10 8 20 0 q10 8 20 0 q10 8 20 0 q10 8 20 0" fill={t.lip} />
      <Rect x={172} y={54} width={4} height={50} fill={t.lip} />
      <Rect x={326} y={54} width={4} height={50} fill={t.lip} />
      {[
        [200, 96],
        [222, 96],
        [244, 96],
        [211, 82],
        [233, 82],
        [222, 68],
      ].map(([x, y]) => (
        <Ellipse key={`${x}-${y}`} cx={x} cy={y} rx={11} ry={8} fill={theme.c.yellow} stroke={theme.c['yellow-lip']} strokeWidth={1.5} />
      ))}
      <Circle cx={80} cy={84} r={18} fill={theme.c.orange} opacity={0.85} />
      <Circle cx={80} cy={84} r={9} fill={theme.c['orange-lip']} opacity={0.6} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Circle key={i} cx={80 + 13 * Math.cos(i)} cy={84 + 13 * Math.sin(i)} r={1.6} fill={theme.c['orange-lip']} />
      ))}
    </G>
  ),
  // 6 The office: a skyline window, a desk lamp, a plant.
  6: ({ t, theme }) => (
    <G>
      <Rect x={150} y={18} width={190} height={86} rx={6} fill={t.c} opacity={0.25} />
      {[160, 186, 210, 236, 262, 290, 312].map((x, i) => (
        <Rect key={x} x={x} y={44 + ((i * 17) % 30)} width={20} height={60 - ((i * 17) % 30)} fill={t.c} opacity={0.7} />
      ))}
      <Path d="M150 60 H340 M245 18 V104" stroke={theme.c.white} strokeWidth={3} />
      <Rect x={40} y={86} width={90} height={6} rx={2} fill={t.lip} />
      <Path d="M60 86 V66 L76 56" stroke={t.lip} strokeWidth={3} fill="none" />
      <Path d="M70 50 L88 56 L80 66 Z" fill={theme.c.yellow} />
      <Rect x={104} y={72} width={14} height={14} rx={3} fill={t.lip} />
      <Path d="M111 72 q-10 -14 -2 -20 M111 72 q8 -12 2 -22 M111 72 q2 -10 10 -14" stroke={theme.c.green} strokeWidth={3} fill="none" strokeLinecap="round" />
    </G>
  ),
  // 7 Chimgan mountains: snowy peaks, a chairlift line, juniper.
  7: ({ t, theme }) => (
    <G>
      <Path d="M120 104 L190 28 L250 104 Z" fill={t.c} opacity={0.6} />
      <Path d="M210 104 L280 40 L350 104 Z" fill={t.c} opacity={0.85} />
      <Path d="M172 48 L190 28 L208 48 L198 44 L190 52 L182 44 Z" fill={theme.c.white} />
      <Path d="M266 54 L280 40 L294 54 L286 51 L280 57 L274 51 Z" fill={theme.c.white} />
      <Path d="M20 30 L340 70" stroke={t.lip} strokeWidth={2} />
      <Path d="M110 41 V52 H124 V41" stroke={t.lip} strokeWidth={2} fill="none" />
      {[40, 64, 88].map((x) => (
        <Path key={x} d={`M${x} 104 L${x + 10} 70 L${x + 20} 104 Z`} fill={theme.c.green} />
      ))}
    </G>
  ),
  // 8 University library: columns, a pediment, a stack of books.
  8: ({ t, theme }) => (
    <G>
      <Path d="M170 40 L250 18 L330 40 Z" fill={t.c} opacity={0.85} />
      <Rect x={170} y={40} width={160} height={8} fill={t.lip} />
      {[180, 208, 236, 264, 292, 316].map((x) => (
        <Rect key={x} x={x} y={48} width={10} height={50} fill={t.c} opacity={0.6} />
      ))}
      <Rect x={164} y={98} width={172} height={6} fill={t.lip} />
      <Rect x={50} y={92} width={60} height={12} rx={2} fill={theme.c.red} />
      <Rect x={56} y={80} width={52} height={12} rx={2} fill={theme.c.lagoon} />
      <Rect x={48} y={68} width={56} height={12} rx={2} fill={theme.c.yellow} />
    </G>
  ),
  // 9 Old Bukhara and Khiva: the Kalta Minor stub, crenellated walls, a stork's nest.
  9: ({ t, theme }) => (
    <G>
      <Path d={`M20 ${GROUND} V70 h10 v-6 h10 v6 h10 v-6 h10 v6 h10 v-6 h10 v6 h10 v-6 h10 v6 h10 V${GROUND} Z`} fill={t.c} opacity={0.55} />
      <Path d="M220 104 L226 36 H284 L290 104 Z" fill={t.c} opacity={0.85} />
      {[48, 62, 76, 90].map((y) => (
        <Path key={y} d={`M${222 + (104 - y) / 12} ${y} H${288 - (104 - y) / 12}`} stroke={theme.c.lagoon} strokeWidth={4} />
      ))}
      <Ellipse cx={255} cy={34} rx={18} ry={5} fill={t.lip} />
      <Path d="M246 30 q9 -10 18 0" stroke={theme.c.white} strokeWidth={4} fill="none" />
      <Path d="M262 22 l10 -6" stroke={theme.c.orange} strokeWidth={2} />
    </G>
  ),
  // 10 Tashkent at night: the TV tower, a crescent moon, stars, city lights.
  10: ({ t, theme }) => (
    <G>
      <Path d="M296 20 a14 14 0 1 0 12 22 a11 11 0 1 1 -12 -22 Z" fill={theme.c.yellow} />
      {[
        [60, 22],
        [120, 14],
        [180, 30],
        [230, 16],
        [340, 54],
      ].map(([x, y]) => (
        <Circle key={`${x}`} cx={x} cy={y} r={2} fill={theme.c.yellow} />
      ))}
      <Path d="M214 104 L222 30 L226 30 L234 104" fill={t.lip} />
      <Ellipse cx={224} cy={54} rx={10} ry={6} fill={t.c} />
      <Path d="M224 30 V8" stroke={t.lip} strokeWidth={2} />
      {[30, 70, 110, 150, 260, 300].map((x, i) => (
        <G key={x}>
          <Rect x={x} y={66 + ((i * 13) % 20)} width={32} height={38 - ((i * 13) % 20)} fill={t.c} opacity={0.7} />
          {windows(x + 5, 72 + ((i * 13) % 20), 3, 2, theme.c.yellow)}
        </G>
      ))}
    </G>
  ),
};

/**
 * The equipped path skin (docs/16 E17) as a light decoration on the band: a backdrop behind the
 * scene and a road along the ground in front of it, a few primitives in theme tokens. Skins
 * without a band motif (or none equipped) draw nothing.
 */
type Skin = { back: Draw; front: Draw };

const SKINS: Record<string, Skin> = {
  // Silk Road caravan: warm dunes rolling behind the place and a dashed caravan road.
  'path.silk_road': {
    back: ({ theme }) => (
      <G>
        <Path d="M0 106 Q50 82 104 98 T214 92 T360 88 V120 H0 Z" fill={theme.c.yellow} opacity={0.32} />
        <Path d="M0 112 Q70 96 150 108 T360 102 V120 H0 Z" fill={theme.c.orange} opacity={0.18} />
      </G>
    ),
    front: ({ theme }) => <Path d="M-4 116 Q90 104 180 112 T364 106" stroke={theme.c['orange-ink']} strokeWidth={3} strokeDasharray="10 7" strokeLinecap="round" fill="none" opacity={0.6} />,
  },
  // Mountain trail: snowy peaks far behind the place and a dashed trail over the ground.
  'path.mountains': {
    back: ({ theme }) => (
      <G opacity={0.4}>
        <Path d="M-10 106 L46 40 L102 106 Z M70 106 L136 28 L202 106 Z M180 106 L240 46 L300 106 Z" fill={theme.c.lagoon} />
        <Path d="M46 40 L35 53 L46 50 L57 53 Z M136 28 L123 43 L136 39 L149 43 Z M240 46 L229 59 L240 56 L251 59 Z" fill={theme.c.white} />
      </G>
    ),
    front: ({ theme }) => <Path d="M-4 116 Q80 106 160 113 T364 108" stroke={theme.c.white} strokeWidth={3} strokeDasharray="7 6" strokeLinecap="round" fill="none" opacity={0.85} />,
  },
};

export const PlaceBand = memo(function PlaceBand({
  n,
  cefr,
  height = 116,
  compact = false,
  skin = null,
  testID,
}: {
  n: number;
  cefr: string;
  height?: number;
  compact?: boolean;
  /** The equipped path skin's id (from the shop), or null. */
  skin?: string | null;
  testID?: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const tn = tone(theme, levelTone(cefr));
  const scene = SCENES[n] ?? SCENES[1];
  const look = skin ? SKINS[skin] : undefined;
  const place = t(`hud.places.${n}`, { defaultValue: '' });
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="header"
      accessibilityLabel={place ? t('hud.path.band', { n, cefr, place }) : t('path.sectionBand', { n, cefr })}
      style={{ height, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: tn.soft }}
    >
      <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }} accessible={false} importantForAccessibility="no-hide-descendants">
        <Svg width="100%" height="100%" viewBox="0 0 360 120" preserveAspectRatio="xMaxYMax slice">
          <Rect x={0} y={GROUND} width={360} height={120 - GROUND} fill={tn.c} opacity={0.35} />
          {look ? look.back({ t: tn, theme }) : null}
          {scene ? scene({ t: tn, theme }) : null}
          {look ? look.front({ t: tn, theme }) : null}
        </Svg>
      </View>
      <View
        style={{ margin: compact ? 10 : 12, paddingVertical: 8, paddingHorizontal: 10, gap: 6, maxWidth: '64%', alignSelf: 'flex-start', borderRadius: radius.md, backgroundColor: tn.soft }}
        importantForAccessibility="no-hide-descendants"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <LevelBadge level={cefr} size="sm" />
          <Txt variant="overline" rawColor={tn.ink}>
            {t('common.section', { n })}
          </Txt>
        </View>
        {place ? (
          <Txt variant="title-s" weight={900} rawColor={tn.ink} numberOfLines={2}>
            {place}
          </Txt>
        ) : null}
      </View>
    </View>
  );
});
