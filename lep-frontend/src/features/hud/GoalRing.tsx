import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { Icon, radius, useTheme } from '@/design';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** An SVG arc from fraction `from` to `to` of a circle, clockwise from twelve o'clock. */
function arc(c: number, r: number, from: number, to: number): string {
  const a0 = 2 * Math.PI * from - Math.PI / 2;
  const a1 = 2 * Math.PI * Math.min(to, from + 0.9999) - Math.PI / 2;
  const x0 = c + r * Math.cos(a0);
  const y0 = c + r * Math.sin(a0);
  const x1 = c + r * Math.cos(a1);
  const y1 = c + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * The daily goal ring (docs/16 E02): track in line-2, fill in the xp token, an optional dashed
 * arc for minutes still waiting on this device (a fact, never an award), and a success check
 * when met. It fills from `from` to `value` over 500 ms; reduced motion shows the end at once.
 * Decorative by itself — the caller gives the accessible label.
 */
export function GoalRing({
  size,
  stroke = 4,
  value,
  from = value,
  pending = 0,
  met = false,
  animate = true,
  delayMs = 0,
  children,
  testID,
}: {
  size: number;
  stroke?: number;
  /** 0…1, the server's minutes over the goal. */
  value: number;
  from?: number;
  /** 0…1 of the goal still waiting to sync, drawn dashed after the fill. */
  pending?: number;
  met?: boolean;
  animate?: boolean;
  delayMs?: number;
  children?: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const c = size / 2;
  const r = c - stroke / 2 - 1;
  const circumference = 2 * Math.PI * r;
  const to = Math.max(0, Math.min(1, value));
  const start = Math.max(0, Math.min(1, from));
  const moving = animate && !theme.reduceMotion && start !== to;
  const progress = useSharedValue(moving ? start : to);

  useEffect(() => {
    progress.value = moving ? withDelay(delayMs, withTiming(to, { duration: 500, easing: Easing.out(Easing.cubic) })) : to;
  }, [to, moving, delayMs, progress]);

  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - progress.value) }));
  const wait = Math.max(0, Math.min(1 - to, pending));
  const badge = Math.max(14, Math.round(size * 0.3));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID={testID}>
      <Svg width={size} height={size} style={{ position: 'absolute', top: 0, start: 0 }}>
        <Circle cx={c} cy={c} r={r} stroke={theme.c['line-2']} strokeWidth={stroke} fill="none" />
        {wait > 0.001 ? (
          <Path d={arc(c, r, to, to + wait)} stroke={theme.c['xp-lip']} strokeWidth={stroke} strokeDasharray={`${stroke * 0.6} ${stroke * 1.6}`} strokeLinecap="round" fill="none" />
        ) : null}
        {to > 0 || moving ? (
          <AnimatedCircle
            cx={c}
            cy={c}
            r={r}
            stroke={theme.c.xp}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            animatedProps={animatedProps}
            rotation={-90}
            origin={`${c}, ${c}`}
          />
        ) : null}
      </Svg>
      {children}
      {met ? (
        <View
          style={{
            position: 'absolute',
            bottom: -2,
            end: -2,
            width: badge,
            height: badge,
            borderRadius: radius.full,
            backgroundColor: theme.c.success,
            borderWidth: 2,
            borderColor: theme.c.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="check" size={badge - 6} color={theme.c['on-success']} strokeWidth={3} />
        </View>
      ) : null}
    </View>
  );
}
