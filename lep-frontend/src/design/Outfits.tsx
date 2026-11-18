import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Line, Path, Polygon, Rect } from 'react-native-svg';

import { Mascot, type MascotPose } from './Icon';
import { useTheme, type Theme } from './theme';

/**
 * Cosmetics drawn over Pip (docs/16 E17). Coordinates are Pip's own 180 × 180 view box, where
 * the body spans x 26–154 and y 28–132 and the eyes sit at (72, 78) and (108, 78). Every colour
 * is a theme token, so outfits follow light and dark mode.
 */
export const OUTFIT_IDS = [
  'outfit.doppi',
  'outfit.ikat_scarf',
  'outfit.round_glasses',
  'outfit.graduation_cap',
  'outfit.chef_hat',
  'outfit.raincoat',
  'outfit.headphones',
  'outfit.astronaut',
] as const;

function outfitArt(id: string, th: Theme, clip: string): React.ReactNode {
  const c = th.c;
  switch (id) {
    case 'outfit.doppi':
      // The four-cornered Uzbek skullcap, black with white pepper-pod (qalampir) motifs.
      return (
        <G>
          <Path d="M58 34 L64 10 Q90 2 116 10 L122 34 Q90 40 58 34 Z" fill={c.navy} />
          <Path d="M58 34 Q90 40 122 34" stroke={c['yellow-lip']} strokeWidth={3} fill="none" />
          {[72, 90, 108].map((x) => (
            <Path key={x} d={`M${x} 14 q6 6 0 16 q-6 -8 0 -16 Z`} fill={c.white} />
          ))}
        </G>
      );
    case 'outfit.ikat_scarf':
      return (
        <G>
          <Defs>
            <ClipPath id={clip}>
              <Path d="M40 108 Q90 124 140 108 L142 124 Q90 140 38 124 Z" />
            </ClipPath>
          </Defs>
          <G clipPath={`url(#${clip})`}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
              <Rect key={k} x={36 + k * 14} y={100} width={14} height={44} fill={[c.pink, c.purple, c.yellow, c.lagoon][k % 4]} />
            ))}
            {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
              <Path key={`z${k}`} d={`M${36 + k * 14} 116 l7 -6 l7 6 l-7 6 Z`} fill={c.white} opacity={0.7} />
            ))}
          </G>
          <Path d="M120 118 l10 26 l10 -4 l-8 -24 Z" fill={c.pink} />
        </G>
      );
    case 'outfit.round_glasses':
      return (
        <G>
          <Circle cx={72} cy={78} r={15} fill={c.white} opacity={0.25} stroke={c.navy} strokeWidth={4} />
          <Circle cx={108} cy={78} r={15} fill={c.white} opacity={0.25} stroke={c.navy} strokeWidth={4} />
          <Path d="M87 76 Q90 72 93 76" stroke={c.navy} strokeWidth={4} fill="none" />
          <Line x1={57} y1={75} x2={34} y2={70} stroke={c.navy} strokeWidth={4} strokeLinecap="round" />
          <Line x1={123} y1={75} x2={146} y2={70} stroke={c.navy} strokeWidth={4} strokeLinecap="round" />
        </G>
      );
    case 'outfit.graduation_cap':
      return (
        <G>
          <Path d="M64 26 L64 36 Q90 44 116 36 L116 26 Z" fill={c.navy} />
          <Polygon points="90,4 140,20 90,34 40,20" fill={c.navy} stroke={c['ink-2']} strokeWidth={2} />
          <Circle cx={90} cy={19} r={3} fill={c.yellow} />
          <Path d="M90 19 L130 26 L132 46" stroke={c.yellow} strokeWidth={3} fill="none" />
          <Rect x={127} y={44} width={10} height={12} rx={3} fill={c.yellow} />
        </G>
      );
    case 'outfit.chef_hat':
      return (
        <G>
          <Rect x={66} y={18} width={48} height={20} rx={4} fill={c.white} stroke={c['line-2']} strokeWidth={2} />
          <Circle cx={72} cy={14} r={13} fill={c.white} stroke={c['line-2']} strokeWidth={2} />
          <Circle cx={108} cy={14} r={13} fill={c.white} stroke={c['line-2']} strokeWidth={2} />
          <Circle cx={90} cy={8} r={15} fill={c.white} stroke={c['line-2']} strokeWidth={2} />
          <Rect x={68} y={20} width={44} height={10} fill={c.white} />
          <Line x1={66} y1={32} x2={114} y2={32} stroke={c['line-2']} strokeWidth={2} />
        </G>
      );
    case 'outfit.raincoat':
      return (
        <G>
          <Path d="M150 30 L150 74 q0 8 -8 8 q-6 0 -7 -6" stroke={c.navy} strokeWidth={4} fill="none" strokeLinecap="round" />
          <Path d="M112 32 Q150 -6 188 32 Q178 26 169 32 Q160 26 150 32 Q140 26 131 32 Q122 26 112 32 Z" fill={c.blue} stroke={c['blue-lip']} strokeWidth={2} />
          <Path d="M30 40 Q90 18 150 40 L150 46 Q90 26 30 46 Z" fill={c.yellow} stroke={c['yellow-lip']} strokeWidth={2} />
        </G>
      );
    case 'outfit.headphones':
      return (
        <G>
          <Path d="M30 70 Q30 8 90 8 Q150 8 150 70" stroke={c.navy} strokeWidth={8} fill="none" strokeLinecap="round" />
          <Rect x={16} y={58} width={20} height={36} rx={9} fill={c.purple} stroke={c['purple-lip']} strokeWidth={3} />
          <Rect x={144} y={58} width={20} height={36} rx={9} fill={c.purple} stroke={c['purple-lip']} strokeWidth={3} />
        </G>
      );
    case 'outfit.astronaut':
      return (
        <G>
          <Circle cx={90} cy={82} r={84} fill={c['blue-soft']} opacity={0.35} stroke={c['line-2']} strokeWidth={6} />
          <Path d="M40 40 Q60 18 92 14" stroke={c.white} strokeWidth={8} fill="none" strokeLinecap="round" opacity={0.8} />
          <Rect x={70} y={160} width={40} height={14} rx={5} fill={c['line-2']} />
          <Circle cx={160} cy={40} r={6} fill={c.red} />
        </G>
      );
    default:
      return null;
  }
}

/** Pip wearing an outfit (or nothing), in any pose. */
export function DressedPip({ outfit, pose = 'happy', size = 120, label }: { outfit: string | null; pose?: MascotPose; size?: number; label?: string }) {
  const theme = useTheme();
  const clip = `o${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const art = outfit ? outfitArt(outfit, theme, clip) : null;
  return (
    <View style={{ width: size, height: size }}>
      <Mascot pose={pose} size={size} label={label} />
      {art ? (
        <Svg width={size} height={size} viewBox="0 0 180 180" style={{ position: 'absolute', top: 0, start: 0 }} pointerEvents="none">
          {art}
        </Svg>
      ) : null}
    </View>
  );
}

/** A swatch for a theme or a path skin in the shop. */
export function CosmeticSwatch({ id, size = 96 }: { id: string; size?: number }) {
  const { c } = useTheme();
  let art: React.ReactNode = null;
  switch (id) {
    case 'theme.samarkand':
      // Registan blue: a tiled dome and an arch.
      art = (
        <G>
          <Rect x={0} y={0} width={100} height={100} rx={18} fill={c['blue-soft']} />
          <Path d="M24 86 V54 Q50 24 76 54 V86 Z" fill={c.blue} />
          <Path d="M36 86 V62 Q50 44 64 62 V86 Z" fill={c['lagoon-soft']} />
          <Ellipse cx={50} cy={30} rx={18} ry={16} fill={c.lagoon} />
          <Rect x={48} y={8} width={4} height={8} fill={c.yellow} />
          {[16, 84].map((x) => (
            <Rect key={x} x={x - 5} y={24} width={10} height={62} rx={3} fill={c['blue-ink']} />
          ))}
        </G>
      );
      break;
    case 'theme.chorsu':
      art = (
        <G>
          <Rect x={0} y={0} width={100} height={100} rx={18} fill={c['orange-soft']} />
          <Path d="M14 80 Q50 10 86 80 Z" fill={c.lagoon} />
          <Path d="M14 80 H86 V88 H14 Z" fill={c.orange} />
          {(
            [
              [30, c.red],
              [50, c.yellow],
              [70, c.green],
            ] as const
          ).map(([x, fill]) => (
            <Circle key={x} cx={x} cy={72} r={5} fill={fill} />
          ))}
        </G>
      );
      break;
    case 'theme.night_tashkent':
      art = (
        <G>
          <Rect x={0} y={0} width={100} height={100} rx={18} fill={c.navy} />
          <Circle cx={72} cy={26} r={12} fill={c.yellow} />
          <Circle cx={78} cy={22} r={11} fill={c.navy} />
          {[
            [20, 20],
            [40, 34],
            [56, 14],
            [86, 50],
          ].map(([x, y]) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={2} fill={c.white} />
          ))}
          <Rect x={18} y={56} width={10} height={36} fill={c.purple} />
          <Path d="M23 40 L23 56" stroke={c.purple} strokeWidth={3} />
          <Rect x={36} y={66} width={20} height={26} fill={c['purple-lip']} />
          <Rect x={62} y={60} width={22} height={32} fill={c.purple} />
          {[42, 50, 68, 76].map((x) => (
            <Rect key={x} x={x} y={72} width={3} height={4} fill={c.yellow} />
          ))}
        </G>
      );
      break;
    case 'path.silk_road':
      art = (
        <G>
          <Rect x={0} y={0} width={100} height={100} rx={18} fill={c['yellow-soft']} />
          <Path d="M0 70 Q30 54 60 70 T100 66 V100 H0 Z" fill={c.yellow} />
          <Path d="M8 96 Q30 70 50 74 T92 40" stroke={c['orange-ink']} strokeWidth={4} strokeDasharray="8 6" fill="none" />
          <Circle cx={92} cy={40} r={6} fill={c.orange} />
          <Circle cx={22} cy={22} r={9} fill={c.orange} opacity={0.8} />
        </G>
      );
      break;
    case 'path.mountains':
      art = (
        <G>
          <Rect x={0} y={0} width={100} height={100} rx={18} fill={c['lagoon-soft']} />
          <Polygon points="0,90 34,30 66,90" fill={c.lagoon} />
          <Polygon points="34,90 68,22 100,90" fill={c['lagoon-ink']} />
          <Polygon points="68,22 60,38 76,38" fill={c.white} />
          <Polygon points="34,30 27,44 41,44" fill={c.white} />
          <Path d="M10 96 Q40 80 56 88 T96 80" stroke={c.white} strokeWidth={3} strokeDasharray="6 5" fill="none" />
        </G>
      );
      break;
    default:
      art = <Rect x={0} y={0} width={100} height={100} rx={18} fill={c['bg-soft']} />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false}>
      {art}
    </Svg>
  );
}
