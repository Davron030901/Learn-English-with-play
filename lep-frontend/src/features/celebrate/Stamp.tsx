import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { Icon, Txt, levelTone, tone, useTheme, type IconName } from '@/design';

/** Seal outlines: a circle, a hexagon and a scalloped edge (docs/16 "Stamps", procedural). */
function outline(kind: number, c: number, r: number): string | null {
  if (kind === 0) return null;
  const n = kind === 1 ? 6 : 24;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    const rr = kind === 1 ? r : i % 2 === 0 ? r : r * 0.9;
    return `${(c + rr * Math.cos(a)).toFixed(2)} ${(c + rr * Math.sin(a)).toFixed(2)}`;
  });
  return `M ${pts.join(' L ')} Z`;
}

const GLYPHS: readonly IconName[] = ['chat', 'book', 'pencil', 'headphones', 'mic'];

/**
 * One passport stamp landing (docs/16 E11 §3): it drops from 1.4× at −8° to rest over 260 ms and
 * an ink ring spreads to 1.3× and fades. Reduced motion: a 150 ms fade. The can-do statement is
 * English being taught, so it is marked `en`.
 */
export const Stamp = memo(function Stamp({ text, level, index, delayMs = 0, testID }: { text: string; level: string; index: number; delayMs?: number; testID?: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const tn = tone(theme, levelTone(level));
  const size = 68;
  const c = size / 2;
  const shape = outline(index % 3, c, c - 3);
  const fade = theme.reduceMotion;

  const land = useSharedValue(0);
  const splash = useSharedValue(0);
  useEffect(() => {
    land.value = withDelay(delayMs, withTiming(1, { duration: fade ? 150 : 260, easing: Easing.out(Easing.quad) }));
    if (!fade) splash.value = withDelay(delayMs + 240, withSequence(withTiming(1, { duration: 1 }), withTiming(0, { duration: 420 })));
  }, [delayMs, fade, land, splash]);

  const stampStyle = useAnimatedStyle(() =>
    fade
      ? { opacity: land.value }
      : {
          opacity: Math.min(1, land.value * 2),
          transform: [{ scale: 1.4 - 0.4 * land.value }, { rotate: `${-8 + 8 * land.value}deg` }],
        },
  );
  const splashStyle = useAnimatedStyle(() => ({ opacity: splash.value * 0.5, transform: [{ scale: 1 + 0.3 * (1 - splash.value) }] }));

  return (
    <View accessible accessibilityLabel={t('celebrate.stampA11y', { text })} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }} testID={testID}>
      <View style={{ width: size, height: size }}>
        {!fade ? (
          <Animated.View style={[{ position: 'absolute', top: 0, start: 0, width: size, height: size, borderRadius: size, borderWidth: 4, borderColor: tn.c }, splashStyle]} />
        ) : null}
        <Animated.View style={[{ width: size, height: size }, stampStyle]}>
          <Svg width={size} height={size}>
            <G opacity={0.88}>{shape ? <Path d={shape} fill={tn.c} /> : <Circle cx={c} cy={c} r={c - 3} fill={tn.c} />}</G>
            <Circle cx={c} cy={c} r={c - 10} stroke={tn.on} strokeWidth={1.6} strokeDasharray="3 3" fill="none" opacity={0.85} />
          </Svg>
          <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={GLYPHS[index % GLYPHS.length] ?? 'chat'} size={26} color={tn.on} />
          </View>
        </Animated.View>
      </View>
      <Txt variant="learn-s" lang="en" style={{ flex: 1, fontSize: 16, lineHeight: 23 }} weight={700}>
        {text}
      </Txt>
    </View>
  );
});
