import { type ReactNode } from 'react';
import {
  Pressable,
  View,
  type AccessibilityRole,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { tone, useTheme, type Tone } from './theme';
import { radius, size as sizes } from './tokens.generated';

type State = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

export interface Press3DProps {
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  /** Fill, lip and optional border colours (already resolved). */
  fill: string;
  lipColor: string;
  lipHeight?: number;
  borderColor?: string;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  children: ReactNode | ((state: State) => ReactNode);
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: { disabled?: boolean; selected?: boolean; checked?: boolean | 'mixed'; busy?: boolean };
  testID?: string;
  lang?: string;
}

/**
 * The design system's pressable 3D surface: a solid lip under the control (no blur), which the
 * control sinks into when pressed; a visible focus ring for keyboard users (brief §12).
 * Reduced motion keeps the colour change and drops the movement.
 */
export function Press3D({
  onPress,
  disabled,
  fill,
  lipColor,
  lipHeight = 4,
  borderColor,
  borderRadius = radius.md,
  style,
  pressedStyle,
  children,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  accessibilityState,
  testID,
  lang,
}: Press3DProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      testID={testID}
      {...(lang ? ({ lang } as object) : {})}
      style={(s: State) => {
        const pressed = s.pressed && !disabled;
        const shadows = [
          pressed ? null : theme.lip(lipColor, lipHeight),
          s.focused ? theme.focusRing : null,
        ].filter(Boolean);
        return [
          {
            backgroundColor: fill,
            borderRadius,
            borderWidth: borderColor ? 2 : 0,
            borderColor,
            marginBottom: lipHeight,
            boxShadow: shadows.length ? shadows.join(', ') : 'none',
            transform: [{ translateY: pressed && !theme.reduceMotion ? lipHeight : 0 }],
            minHeight: sizes['tap-min'],
            minWidth: sizes['tap-min'],
          } satisfies ViewStyle,
          style,
          pressed ? pressedStyle : null,
          s.hovered && !disabled ? { opacity: 0.94 } : null,
        ];
      }}
    >
      {children}
    </Pressable>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'gold' | 'ghost';

export interface ButtonProps {
  children: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'lg' | 'md' | 'sm';
  block?: boolean;
  icon?: IconName;
  iconRight?: IconName;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** The pressable 3D button. One primary per screen. */
export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  block,
  icon,
  iconRight,
  disabled,
  busy,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const off = disabled || busy;
  let fill: string;
  let lip: string;
  let on: string;
  let border: string | undefined;
  if (off) {
    fill = variant === 'ghost' ? 'transparent' : theme.c.disabled;
    lip = variant === 'ghost' ? 'transparent' : theme.c['line-2'];
    on = theme.c['ink-4'];
  } else if (variant === 'secondary') {
    fill = theme.c.surface;
    lip = theme.c.edge;
    on = theme.c['primary-ink'];
    border = theme.c['line-2'];
  } else if (variant === 'ghost') {
    fill = 'transparent';
    lip = 'transparent';
    on = theme.c['primary-ink'];
  } else {
    const tn: Tone = variant === 'gold' ? 'xp' : variant;
    const t = tone(theme, tn);
    fill = t.c;
    lip = t.lip;
    on = t.on;
  }
  const height = size === 'lg' ? sizes['control-lg'] : size === 'sm' ? sizes['control-sm'] : sizes['control-md'];
  const iconSize = size === 'sm' ? 18 : 22;
  return (
    <Press3D
      onPress={onPress}
      disabled={off}
      fill={fill}
      lipColor={lip}
      lipHeight={variant === 'ghost' ? 0 : 4}
      borderColor={off ? undefined : border}
      borderRadius={size === 'sm' ? radius.sm : radius.md}
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: !!busy }}
      testID={testID}
      style={[
        {
          height,
          paddingHorizontal: size === 'lg' ? 28 : size === 'sm' ? 16 : 22,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          alignSelf: block ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={iconSize} color={on} /> : null}
      <Txt
        variant="label"
        rawColor={on}
        numberOfLines={2}
        style={{ fontSize: size === 'lg' ? 18 : size === 'sm' ? 15 : 17, textAlign: 'center', flexShrink: 1 }}
      >
        {children}
      </Txt>
      {iconRight ? <Icon name={iconRight} size={iconSize} color={on} /> : null}
    </Press3D>
  );
}

/** A 44 px icon-only button; `label` is its accessible name. */
export function IconButton({
  icon,
  label,
  onPress,
  variant = 'plain',
  size = 'md',
  disabled,
  testID,
  rotate,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  variant?: 'plain' | 'soft' | 'primary' | 'secondary';
  size?: 'md' | 'lg';
  disabled?: boolean;
  testID?: string;
  /** Rotates the glyph (the set has one chevron per axis; "up" is chevron-down turned over). */
  rotate?: '90deg' | '180deg' | '270deg';
}) {
  const theme = useTheme();
  const dim = size === 'lg' ? 56 : 44;
  const fill =
    variant === 'soft'
      ? theme.c['bg-soft']
      : variant === 'primary'
        ? theme.c.primary
        : variant === 'secondary'
          ? theme.c.surface
          : 'transparent';
  const on =
    variant === 'primary'
      ? theme.c['on-primary']
      : variant === 'secondary'
        ? theme.c['primary-ink']
        : variant === 'soft'
          ? theme.c['ink-2']
          : theme.c['ink-3'];
  const lip = variant === 'primary' ? theme.c['primary-lip'] : variant === 'secondary' ? theme.c.edge : 'transparent';
  return (
    <Press3D
      onPress={onPress}
      disabled={disabled}
      fill={fill}
      lipColor={lip}
      lipHeight={variant === 'primary' || variant === 'secondary' ? 4 : 0}
      borderColor={variant === 'secondary' ? theme.c['line-2'] : undefined}
      borderRadius={size === 'lg' ? 16 : 14}
      accessibilityLabel={label}
      testID={testID}
      style={{ width: dim, height: dim, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={icon} size={size === 'lg' ? 30 : 26} color={disabled ? theme.c['ink-4'] : on} style={rotate ? { transform: [{ rotate }] } : undefined} />
    </Press3D>
  );
}

/** An inline text action (the design system's .lp-link): 44 px tall, never a bare word. */
export function TextLink({
  children,
  onPress,
  icon,
  color,
  testID,
  accessibilityHint,
}: {
  children: string;
  onPress: () => void;
  icon?: IconName;
  color?: string;
  testID?: string;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const c = color ?? theme.c['primary-ink'];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={(s: State) => ({
        minHeight: sizes['tap-min'],
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 6,
        borderRadius: 10,
        boxShadow: s.focused ? theme.focusRing : 'none',
        opacity: s.pressed ? 0.7 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={19} color={c} /> : null}
      <Txt variant="body-m" weight={800} rawColor={c} style={{ fontSize: 15, lineHeight: 20, flexShrink: 1 }}>
        {children}
      </Txt>
    </Pressable>
  );
}

export function Row({ children, gap = 8, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: 'wrap' }, style]}>{children}</View>;
}
