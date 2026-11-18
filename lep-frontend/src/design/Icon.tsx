import { useId, useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect, SvgXml } from 'react-native-svg';

import { colorIcons, icons, pipPoses, type ArtElement } from './art.generated';
import { Txt } from './Txt';
import { useTheme } from './theme';

export type IconName = keyof typeof icons;
export type MascotPose = keyof typeof pipPoses;

function camel(k: string) {
  return k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

function renderElement(el: ArtElement, i: number, colored: boolean, current: string) {
  const [tag, raw] = el;
  const attrs: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'nostroke') continue;
    attrs[camel(k)] = v;
  }
  if (!colored) {
    if (attrs.fill === 'c') attrs.fill = current;
    if ('nostroke' in raw) attrs.stroke = 'none';
  }
  switch (tag) {
    case 'path':
      return <Path key={i} {...(attrs as object)} />;
    case 'circle':
      return <Circle key={i} {...(attrs as object)} />;
    case 'rect':
      return <Rect key={i} {...(attrs as object)} />;
  }
}

export interface IconProps {
  name: IconName;
  size?: number;
  /** "color" uses the brand-coloured drawing where one exists (flame, bolt, gem, star, trophy, shield). */
  tone?: 'current' | 'color';
  color?: string;
  strokeWidth?: number;
  /** Accessible name; without it the icon is decorative and hidden from screen readers. */
  title?: string;
  style?: StyleProp<ViewStyle>;
}

/** One icon from the design system's 24 px line set. */
export function Icon({ name, size = 24, tone: t = 'current', color, strokeWidth = 2.2, title, style }: IconProps) {
  const theme = useTheme();
  const current = color ?? theme.c.ink;
  const coloredList = t === 'color' ? (colorIcons as Record<string, readonly ArtElement[]>)[name] : undefined;
  const list = coloredList ?? (icons as Record<string, readonly ArtElement[]>)[name] ?? icons.info;
  const a11y = title
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: title }
    : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const, 'aria-hidden': true };
  return (
    <View style={[{ width: size, height: size }, style]} {...a11y}>
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        {...(coloredList
          ? {}
          : { stroke: current, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const })}
      >
        {list.map((el, i) => renderElement(el, i, !!coloredList, current))}
      </Svg>
    </View>
  );
}

/** Pip, the speech-bubble mascot. Decorative unless `label` is given. There is no sad pose. */
export function Mascot({ pose = 'happy', size = 120, label }: { pose?: MascotPose; size?: number; label?: string }) {
  const rawId = useId();
  const id = useMemo(() => `pip${rawId.replace(/[^a-zA-Z0-9]/g, '')}`, [rawId]);
  const xml = useMemo(() => {
    const inner = (pipPoses[pose] ?? pipPoses.happy).replace(/pip-m-/g, `${id}-m-`);
    return `<svg viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg"><g transform="translate(10 12)">${inner}</g></svg>`;
  }, [pose, id]);
  const a11y = label
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label }
    : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const, 'aria-hidden': true };
  return (
    <View style={{ width: size, height: size }} {...a11y}>
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  );
}

/** The wordmark with Pip. `on="color"` for white-on-blue placements. */
export function Logo({
  variant = 'stacked',
  size = 28,
  on = 'surface',
}: {
  variant?: 'stacked' | 'inline' | 'mark';
  size?: number;
  on?: 'surface' | 'color';
}) {
  const theme = useTheme();
  const ink = on === 'color' ? theme.c.white : theme.c.ink;
  const play = on === 'color' ? theme.c.yellow : theme.c['primary-ink'];
  const mark = variant === 'inline' ? size * 1.5 : size * 1.9;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Learn English with Play"
      style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.32 }}
    >
      <Mascot pose="happy" size={mark} />
      {variant !== 'mark' ? (
        <View style={{ flexDirection: variant === 'inline' ? 'row' : 'column', gap: variant === 'inline' ? size * 0.26 : 0 }}>
          <Txt variant="title-l" weight={900} rawColor={ink} style={{ fontSize: size, lineHeight: size * 1.05 }}>
            Learn English
          </Txt>
          <Txt variant="title-l" weight={900} rawColor={ink} style={{ fontSize: size, lineHeight: size * 1.05 }}>
            with <Txt variant="title-l" weight={900} rawColor={play} style={{ fontSize: size, lineHeight: size * 1.05 }}>Play</Txt>
          </Txt>
        </View>
      ) : null}
    </View>
  );
}
