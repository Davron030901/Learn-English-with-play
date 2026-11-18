import { type ReactNode } from 'react';
import { Pressable, View, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { levelTone, tone, useTheme, type Tone } from './theme';
import { radius, space } from './tokens.generated';

type State = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

// ---------------------------------------------------------------- Chip
export function Chip({
  children,
  tone: tn,
  icon,
  size = 'md',
  variant = 'soft',
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: IconName;
  size?: 'md' | 'sm';
  variant?: 'soft' | 'solid' | 'outline';
}) {
  const theme = useTheme();
  const t = tn ? tone(theme, tn) : { c: theme.c['ink-3'], soft: theme.c['bg-soft'], ink: theme.c['ink-2'], on: theme.c.bg, lip: theme.c.edge };
  const bg = variant === 'solid' ? t.c : variant === 'outline' ? 'transparent' : t.soft;
  const fg = variant === 'solid' ? t.on : t.ink;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: size === 'sm' ? 4 : 6,
        minHeight: size === 'sm' ? 24 : 30,
        paddingHorizontal: size === 'sm' ? 9 : 12,
        borderRadius: radius.full,
        backgroundColor: bg,
        borderWidth: variant === 'outline' ? 2 : 0,
        borderColor: t.ink,
      }}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} color={fg} /> : null}
      <Txt variant="caption" weight={800} rawColor={fg} style={{ fontSize: size === 'sm' ? 12 : 13 }}>
        {children}
      </Txt>
    </View>
  );
}

// ---------------------------------------------------------------- LevelBadge
export function LevelBadge({ level, size = 'md', label }: { level: string; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const theme = useTheme();
  const t = tone(theme, levelTone(level));
  const h = size === 'sm' ? 24 : size === 'lg' ? 44 : 30;
  const lip = size === 'sm' ? 2 : size === 'lg' ? 4 : 3;
  return (
    <View
      accessible
      accessibilityLabel={label ?? `Level ${level}`}
      style={{
        height: h,
        paddingHorizontal: size === 'sm' ? 8 : size === 'lg' ? 16 : 11,
        borderRadius: size === 'sm' ? 8 : size === 'lg' ? 14 : 10,
        backgroundColor: t.c,
        boxShadow: theme.lip(t.lip, lip),
        marginBottom: lip,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
      }}
    >
      <Txt variant="label" weight={900} rawColor={t.on} style={{ fontSize: size === 'sm' ? 13 : size === 'lg' ? 20 : 15, lineHeight: size === 'lg' ? 24 : 16 }}>
        {level}
      </Txt>
    </View>
  );
}

// ---------------------------------------------------------------- ProgressBar
export function ProgressBar({
  value,
  max = 1,
  tone: tn = 'primary',
  size = 'lg',
  track = 'neutral',
  label,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  size?: 'lg' | 'md' | 'sm';
  track?: 'neutral' | 'tint';
  label: string;
}) {
  const theme = useTheme();
  const t = tone(theme, tn);
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const h = size === 'sm' ? 8 : size === 'md' ? 12 : 16;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ flex: 1, height: h, borderRadius: radius.full, backgroundColor: track === 'tint' ? t.soft : theme.c.line, overflow: 'hidden' }}
    >
      {pct > 0 ? (
        <View style={{ width: `${pct * 100}%`, minWidth: h, height: h, borderRadius: radius.full, backgroundColor: t.c }}>
          {size === 'lg' ? (
            <View style={{ position: 'absolute', start: 8, end: 8, top: 3, height: 4, borderRadius: 4, backgroundColor: theme.c.white, opacity: 0.32 }} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- Card
export function Card({
  children,
  soft,
  style,
  padded = true,
}: {
  children: ReactNode;
  soft?: boolean;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: soft ? theme.c['bg-soft'] : theme.c.surface,
          borderWidth: 2,
          borderColor: soft ? 'transparent' : theme.c.line,
          borderRadius: radius.lg,
          padding: padded ? space['4'] : 0,
          gap: space['3'],
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children, overline }: { children: string; overline?: string }) {
  return (
    <View style={{ gap: 2 }} accessibilityRole="header">
      {overline ? (
        <Txt variant="overline" color="ink-3">
          {overline}
        </Txt>
      ) : null}
      <Txt variant="title-s">{children}</Txt>
    </View>
  );
}

// ---------------------------------------------------------------- ListRow
export function ListRow({
  icon,
  iconTone = 'current',
  tone: tn = 'primary',
  title,
  sub,
  value,
  onPress,
  chevron,
  children,
  testID,
  accessibilityHint,
}: {
  icon?: IconName;
  iconTone?: 'current' | 'color';
  tone?: Tone;
  title: string;
  sub?: string;
  value?: string;
  onPress?: () => void;
  chevron?: boolean;
  children?: ReactNode;
  testID?: string;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const t = tone(theme, tn);
  const body = (
    <>
      {icon ? (
        <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={24} color={t.ink} tone={iconTone} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt variant="body-m" weight={800}>
          {title}
        </Txt>
        {sub ? (
          <Txt variant="body-s" color="ink-3">
            {sub}
          </Txt>
        ) : null}
      </View>
      {value ? (
        <Txt variant="body-m" weight={800} color="ink-2" style={{ fontSize: 15, flexShrink: 1, textAlign: 'right' }}>
          {value}
        </Txt>
      ) : null}
      {children}
      {onPress || chevron ? <Icon name="chevron-right" size={22} color={theme.c['ink-3']} /> : null}
    </>
  );
  const rowStyle: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 10, paddingHorizontal: 2, borderRadius: 14 };
  if (!onPress) return <View style={rowStyle}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, sub, value].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={(s: State) => [rowStyle, { boxShadow: s.focused ? theme.focusRing : 'none', backgroundColor: s.pressed ? theme.c['bg-soft'] : 'transparent' }]}
    >
      {body}
    </Pressable>
  );
}

// ---------------------------------------------------------------- Switch
export function Switch({
  label,
  sub,
  value,
  onValueChange,
  disabled,
  testID,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={sub}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      testID={testID}
      style={(s: State) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        minHeight: 56,
        borderRadius: 12,
        opacity: disabled ? 0.5 : 1,
        boxShadow: s.focused ? theme.focusRing : 'none',
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt variant="body-m" weight={800}>
          {label}
        </Txt>
        {sub ? (
          <Txt variant="body-s" color="ink-3">
            {sub}
          </Txt>
        ) : null}
      </View>
      <View style={{ width: 52, height: 32, borderRadius: radius.full, backgroundColor: value ? theme.c.primary : theme.c.edge, justifyContent: 'center' }}>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: radius.full,
            backgroundColor: theme.c.white,
            marginStart: value ? 24 : 4,
            boxShadow: `0px 1px 2px 0px ${theme.c.scrim}`,
          }}
        />
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------- Segmented
export function Segmented<T extends string | number>({
  label,
  showLabel = true,
  options,
  value,
  onChange,
  testID,
}: {
  label?: string;
  /** false keeps the label as the group's accessible name only. */
  showLabel?: boolean;
  options: readonly { value: T; label: string; caption?: string }[];
  value: T;
  onChange: (v: T) => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID}>
      {label && showLabel ? (
        <Txt variant="body-m" weight={800}>
          {label}
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 4, borderRadius: 16, backgroundColor: theme.c['bg-soft'] }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={o.caption ? `${o.label}, ${o.caption}` : o.label}
              style={(s: State) => ({
                flexGrow: 1,
                flexBasis: 72,
                minHeight: 52,
                paddingVertical: 6,
                paddingHorizontal: 4,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: on ? theme.c.surface : 'transparent',
                borderWidth: 2,
                borderColor: on ? theme.c.primary : 'transparent',
                boxShadow: [on ? theme.lip(theme.c.edge, 2) : null, s.focused ? theme.focusRing : null].filter(Boolean).join(', ') || 'none',
              })}
            >
              <Txt variant="body-m" weight={800} rawColor={on ? theme.c['primary-ink'] : theme.c['ink-2']} align="center" style={{ fontSize: 15, lineHeight: 19 }}>
                {o.label}
              </Txt>
              {o.caption ? (
                <Txt variant="caption" color="ink-3" align="center" style={{ fontSize: 12, lineHeight: 15 }}>
                  {o.caption}
                </Txt>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- SpeechBubble / Avatar
export function SpeechBubble({ children, tail = 'left' }: { children: ReactNode; tail?: 'left' | 'bottom' | 'none' }) {
  const theme = useTheme();
  return (
    <View style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
      <View style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 18, backgroundColor: theme.c.surface, borderWidth: 2, borderColor: theme.c['line-2'] }}>
        {typeof children === 'string' ? (
          <Txt variant="body-l" weight={700} style={{ fontSize: 17, lineHeight: 24 }}>
            {children}
          </Txt>
        ) : (
          children
        )}
      </View>
      {tail !== 'none' ? (
        <View
          style={{
            position: 'absolute',
            width: 14,
            height: 14,
            backgroundColor: theme.c.surface,
            borderColor: theme.c['line-2'],
            borderStartWidth: 2,
            borderBottomWidth: 2,
            ...(tail === 'left'
              ? { start: -7, top: '50%', marginTop: -7, transform: [{ rotate: '45deg' }] }
              : { start: 28, bottom: -7, transform: [{ rotate: '-45deg' }] }),
          }}
        />
      ) : null}
    </View>
  );
}

export function Avatar({ name, tone: tn = 'blue', size = 'md' }: { name: string; tone?: Tone; size?: 'sm' | 'md' | 'lg' }) {
  const theme = useTheme();
  const t = tone(theme, tn);
  const px = size === 'sm' ? 32 : size === 'lg' ? 56 : 40;
  const words = name.split(/[·•|,(]/)[0]?.split(/\s+/).filter((w) => /^\p{L}/u.test(w)) ?? [];
  const initials = words.length ? words.map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase() : '?';
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
      style={{ width: px, height: px, borderRadius: radius.full, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}
    >
      <Txt variant="label" weight={900} rawColor={t.ink} style={{ fontSize: size === 'sm' ? 13 : size === 'lg' ? 20 : 15 }}>
        {initials}
      </Txt>
    </View>
  );
}

// ---------------------------------------------------------------- Notice (an honest "not yet" line)
export function Notice({ icon = 'info', title, children, tone: tn = 'blue' }: { icon?: IconName; title?: string; children: ReactNode; tone?: Tone }) {
  const theme = useTheme();
  const t = tone(theme, tn);
  return (
    <View style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 14, backgroundColor: t.soft, alignItems: 'flex-start' }}>
      <Icon name={icon} size={22} color={t.ink} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Txt variant="body-m" weight={800} rawColor={t.ink}>
            {title}
          </Txt>
        ) : null}
        {typeof children === 'string' ? (
          <Txt variant="body-s" color="ink-2">
            {children}
          </Txt>
        ) : (
          children
        )}
      </View>
    </View>
  );
}
