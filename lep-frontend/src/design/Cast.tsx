import { View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import { useTheme, type Theme } from './theme';

/**
 * Portraits of the story's cast (docs/16 E21, E24): drawn from shapes and design tokens, no
 * external art. Two expressions — `smile` at rest and `talk` while a reply is being written.
 * Decorative unless `label` is given.
 */
export type CastExpression = 'smile' | 'talk';

type Look = {
  skin: 'cast-skin-1' | 'cast-skin-2' | 'cast-skin-3';
  hair: 'cast-hair-dark' | 'cast-hair-brown' | 'cast-hair-auburn' | 'cast-hair-grey';
  style: 'long' | 'short' | 'bun' | 'cap' | 'side';
  shirt: 'blue' | 'green' | 'pink' | 'purple' | 'lagoon' | 'orange';
  glasses?: boolean;
  moustache?: boolean;
};

const LOOKS: Record<string, Look> = {
  sarah: { skin: 'cast-skin-1', hair: 'cast-hair-auburn', style: 'long', shirt: 'lagoon' },
  aziz: { skin: 'cast-skin-2', hair: 'cast-hair-dark', style: 'short', shirt: 'orange' },
  kamola: { skin: 'cast-skin-2', hair: 'cast-hair-dark', style: 'bun', shirt: 'pink' },
  bobur: { skin: 'cast-skin-3', hair: 'cast-hair-dark', style: 'cap', shirt: 'green' },
  karimov: { skin: 'cast-skin-2', hair: 'cast-hair-grey', style: 'side', shirt: 'blue', glasses: true, moustache: true },
};
const FALLBACK: Look = { skin: 'cast-skin-2', hair: 'cast-hair-brown', style: 'short', shirt: 'purple' };

/** The accent a character's bubbles and chips use. */
export function castTone(id: string): Look['shirt'] {
  return (LOOKS[id] ?? FALLBACK).shirt;
}

function hairBack(look: Look, c: Theme['c']) {
  const fill = c[look.hair];
  switch (look.style) {
    case 'long':
      return <Path d="M22 50 C20 22 80 22 78 50 L82 92 L18 92 Z" fill={fill} />;
    case 'bun':
      return <Circle cx={50} cy={17} r={11} fill={fill} />;
    case 'short':
    case 'cap':
    case 'side':
      return null;
  }
}

function hairFront(look: Look, c: Theme['c']) {
  const fill = c[look.hair];
  switch (look.style) {
    case 'long':
      return <Path d="M27 44 C28 24 72 22 74 44 C64 36 46 34 27 44 Z" fill={fill} />;
    case 'bun':
      return <Path d="M27 42 C30 22 70 22 73 42 C62 33 40 32 27 42 Z" fill={fill} />;
    case 'short':
      return <Path d="M27 42 C27 20 73 20 73 42 C70 34 62 30 54 32 C46 28 34 32 27 42 Z" fill={fill} />;
    case 'side':
      return <Path d="M27 40 C29 25 71 24 73 40 C66 31 46 30 36 34 C32 35 29 37 27 40 Z" fill={fill} />;
    case 'cap':
      return (
        <>
          <Path d="M26 38 C27 18 73 18 74 38 Z" fill={c[look.shirt]} />
          <Rect x={50} y={34} width={30} height={6} rx={3} fill={c[`${look.shirt}-lip`]} />
        </>
      );
  }
}

export function CastPortrait({
  id,
  size = 48,
  expression = 'smile',
  label,
}: {
  id: string;
  size?: number;
  expression?: CastExpression;
  label?: string;
}) {
  const { c } = useTheme();
  const look = LOOKS[id] ?? FALLBACK;
  const line = c['cast-line'];
  const a11y = label
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label }
    : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const, 'aria-hidden': true };
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: c[`${look.shirt}-soft`] }} {...a11y}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        {hairBack(look, c)}
        {/* shoulders and neck */}
        <Path d="M14 100 C16 78 32 72 50 72 C68 72 84 78 86 100 Z" fill={c[look.shirt]} />
        <Rect x={43} y={62} width={14} height={14} rx={5} fill={c[look.skin]} />
        {/* head */}
        <Ellipse cx={50} cy={47} rx={23} ry={25} fill={c[look.skin]} />
        <Circle cx={27} cy={50} r={4} fill={c[look.skin]} />
        <Circle cx={73} cy={50} r={4} fill={c[look.skin]} />
        {hairFront(look, c)}
        {/* face */}
        <Circle cx={41} cy={49} r={2.6} fill={line} />
        <Circle cx={59} cy={49} r={2.6} fill={line} />
        <Path d="M36 42 Q41 39 45 42" stroke={line} strokeWidth={1.8} fill="none" strokeLinecap="round" />
        <Path d="M55 42 Q59 39 64 42" stroke={line} strokeWidth={1.8} fill="none" strokeLinecap="round" />
        <Circle cx={35} cy={57} r={3.5} fill={c['cast-cheek']} opacity={0.55} />
        <Circle cx={65} cy={57} r={3.5} fill={c['cast-cheek']} opacity={0.55} />
        {look.glasses ? (
          <>
            <Circle cx={41} cy={49} r={6.5} stroke={line} strokeWidth={1.8} fill="none" />
            <Circle cx={59} cy={49} r={6.5} stroke={line} strokeWidth={1.8} fill="none" />
            <Path d="M47.5 49 L52.5 49" stroke={line} strokeWidth={1.8} />
          </>
        ) : null}
        {look.moustache ? <Path d="M41 59 Q50 55 59 59 Q50 62 41 59 Z" fill={c[look.hair]} /> : null}
        {expression === 'talk' ? (
          <Ellipse cx={50} cy={63} rx={5} ry={4} fill={line} />
        ) : (
          <Path d="M43 61 Q50 67 57 61" stroke={line} strokeWidth={2.2} fill="none" strokeLinecap="round" />
        )}
      </Svg>
    </View>
  );
}
