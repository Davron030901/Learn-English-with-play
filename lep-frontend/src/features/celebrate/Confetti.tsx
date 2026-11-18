import { memo, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/design';
import { usePrefs } from '@/state/prefs';

/**
 * Confetti (docs/16 "Celebration effects"): 40–60 SVG rects, dots and ribbons in the next level's
 * colour family, thrown up from the middle and falling under gravity with air drag and spin, for
 * about 1.8 s, then unmounted. One shared clock drives every piece on the UI thread.
 *
 * Reached only from the section and streak-365 celebrations (and a level award, when one exists).
 * Never in "calm" celebrations, never with reduced motion — the component renders nothing then.
 */

const GRAVITY = 1400; // px/s²
const DRAG = 2.5; // 1/s
const TERMINAL = GRAVITY / DRAG;

interface Piece {
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  spin: number;
  delay: number;
  shape: 0 | 1 | 2;
  size: number;
  color: string;
}

/** A small seeded generator: the same burst every time for the same seed (stable in tests). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10_000) / 10_000;
  };
}

function pieces(count: number, width: number, height: number, colors: readonly string[], seed: number): Piece[] {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => ({
    x0: width / 2 + (r() - 0.5) * 80,
    y0: height * 0.32 + (r() - 0.5) * 40,
    vx: (r() - 0.5) * 1300,
    vy: -500 - r() * 700,
    spin: (r() - 0.5) * 900,
    delay: r() * 0.18,
    shape: (i % 3) as 0 | 1 | 2,
    size: 7 + r() * 6,
    color: colors[i % colors.length] ?? colors[0] ?? '',
  }));
}

const ConfettiPiece = memo(function ConfettiPiece({ p, clock, duration }: { p: Piece; clock: SharedValue<number>; duration: number }) {
  const style = useAnimatedStyle(() => {
    const t = Math.max(0, clock.value - p.delay);
    const decay = (1 - Math.exp(-DRAG * t)) / DRAG;
    const x = p.x0 + p.vx * decay;
    const y = p.y0 + TERMINAL * t + (p.vy - TERMINAL) * decay;
    const left = duration - clock.value;
    return {
      opacity: left < 0.4 ? Math.max(0, left / 0.4) : 1,
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${p.spin * t}deg` }, { rotateX: `${p.spin * 0.6 * t}deg` }],
    };
  });
  const s = p.size;
  return (
    <Animated.View style={[{ position: 'absolute', top: 0, start: 0, width: s * 1.6, height: s * 1.6 }, style]}>
      <Svg width={s * 1.6} height={s * 1.6} viewBox="0 0 16 16">
        {p.shape === 0 ? <Rect x={4} y={1} width={8} height={14} rx={1.5} fill={p.color} /> : null}
        {p.shape === 1 ? <Circle cx={8} cy={8} r={5} fill={p.color} /> : null}
        {p.shape === 2 ? <Path d="M1 9 C4 3, 7 13, 10 7 S14 5, 15 8" stroke={p.color} strokeWidth={3} strokeLinecap="round" fill="none" /> : null}
      </Svg>
    </Animated.View>
  );
});

export function Confetti({ colors, count = 48, durationMs = 1_800, seed = 7, onDone }: { colors: readonly string[]; count?: number; durationMs?: number; seed?: number; onDone?: () => void }) {
  const theme = useTheme();
  const calm = usePrefs((s) => s.celebrations) === 'calm';
  const { width, height } = useWindowDimensions();
  const off = calm || theme.reduceMotion;
  const [alive, setAlive] = useState(!off);
  const duration = durationMs / 1000;
  const clock = useSharedValue(0);
  const list = useMemo(() => pieces(Math.max(40, Math.min(60, count)), width, height, colors, seed), [count, width, height, colors, seed]);

  const finished = useEffectEvent(() => onDone?.());
  // The burst runs once per mount (its inputs do not change while it flies).
  useEffect(() => {
    if (off) return;
    clock.value = withTiming(duration, { duration: durationMs, easing: Easing.linear });
    const id = setTimeout(() => {
      setAlive(false);
      finished();
    }, durationMs + 50);
    return () => clearTimeout(id);
  }, [off, clock, duration, durationMs]);

  if (off || !alive) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, direction: 'ltr' }} accessible={false} importantForAccessibility="no-hide-descendants" testID="confetti">
      {list.map((p, i) => (
        <ConfettiPiece key={i} p={p} clock={clock} duration={duration} />
      ))}
    </View>
  );
}
