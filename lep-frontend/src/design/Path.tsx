import { Pressable, View, type PressableStateCallbackType } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { levelTone, tone, useTheme } from './theme';
import { radius } from './tokens.generated';

type State = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

export type PathNodeKind =
  | 'lesson'
  | 'lexis'
  | 'grammar'
  | 'mixed'
  | 'story'
  | 'speak'
  | 'immersion'
  | 'review'
  | 'clinic'
  | 'checkpoint';

const KIND_ICON: Record<PathNodeKind, IconName> = {
  lesson: 'star',
  lexis: 'letters',
  grammar: 'blocks',
  mixed: 'star',
  story: 'book',
  speak: 'mic',
  immersion: 'headphones',
  review: 'refresh',
  clinic: 'magnifier',
  checkpoint: 'trophy',
};

/**
 * One stop on the path. Pips count the node's *populated* tiers (brief §2.1: 4 nodes have fewer
 * than three) and fill for tiers finished on this device; all three done adds the star.
 */
export function PathNode({
  kind,
  state,
  level,
  populated,
  done,
  callout,
  caption,
  accessibilityLabel,
  onPress,
  testID,
}: {
  kind: PathNodeKind;
  state: 'locked' | 'open' | 'current';
  level: string;
  populated: number;
  done: number;
  callout?: string;
  caption?: string;
  accessibilityLabel: string;
  onPress?: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const t = kind === 'checkpoint' ? tone(theme, 'xp') : tone(theme, levelTone(level));
  const locked = state === 'locked';
  const current = state === 'current';
  const fill = locked ? theme.c.disabled : t.c;
  const lip = locked ? theme.c['line-2'] : t.lip;
  const on = locked ? theme.c['ink-4'] : t.on;
  const w = current ? 88 : 76;
  const h = current ? 80 : 70;
  const lipH = current ? 7 : 6;
  const allDone = populated > 0 && done >= populated;
  return (
    <View style={{ alignItems: 'center', gap: 8, width: 120 }}>
      {current && callout ? (
        <View style={{ marginBottom: 4, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 12, backgroundColor: theme.c.surface, borderWidth: 2, borderColor: theme.c['line-2'], boxShadow: theme.lip(theme.c['line-2'], 3) }}>
          <Txt variant="label" weight={900} rawColor={t.ink} style={{ fontSize: 15, lineHeight: 18 }}>
            {callout}
          </Txt>
        </View>
      ) : null}
      <Pressable
        onPress={onPress}
        disabled={locked || !onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: locked }}
        testID={testID}
        style={(s: State) => {
          const pressed = s.pressed && !locked;
          const shadows = [
            pressed ? null : theme.lip(lip, lipH),
            current ? `0px 0px 0px 7px ${theme.c.bg}, 0px 0px 0px 12px ${t.soft}` : null,
            s.focused ? theme.focusRing : null,
          ].filter(Boolean);
          return {
            width: w,
            height: h,
            borderRadius: current ? 30 : radius.xl,
            backgroundColor: fill,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: lipH,
            boxShadow: shadows.join(', ') || 'none',
            transform: [{ translateY: pressed && !theme.reduceMotion ? lipH : 0 }],
          };
        }}
      >
        <Icon name={locked ? 'lock' : KIND_ICON[kind]} size={current ? 40 : 34} color={on} />
        {allDone ? (
          <View style={{ position: 'absolute', top: -9, end: -9, width: 30, height: 30, borderRadius: radius.full, backgroundColor: theme.c.surface, boxShadow: `0px 0px 0px 3px ${theme.c.bg}`, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="star" tone="color" size={22} />
          </View>
        ) : null}
      </Pressable>
      {populated > 0 ? (
        <View style={{ flexDirection: 'row', gap: 5 }} accessible={false}>
          {Array.from({ length: populated }, (_, i) => (
            <View
              key={i}
              style={{
                width: 14,
                height: 7,
                borderRadius: 4,
                backgroundColor: i < done ? t.ink : 'transparent',
                borderWidth: i < done ? 0 : 2,
                borderColor: locked ? theme.c['line-2'] : theme.c.edge,
              }}
            />
          ))}
        </View>
      ) : null}
      {caption ? (
        <Txt variant="caption" color="ink-3" align="center" weight={800} numberOfLines={2} style={{ maxWidth: 116 }}>
          {caption}
        </Txt>
      ) : null}
    </View>
  );
}

/** A small pill on a unit banner: where the learner is, or that the unit is done. */
export interface BannerStatus {
  icon: IconName;
  label: string;
}

/** A quiet second action on a unit banner (the test-out key, docs/16 E14). */
export interface BannerAction {
  icon: IconName;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}

export function UnitBanner({
  overline,
  title,
  cando,
  level,
  actionLabel,
  actionIcon = 'book',
  onAction,
  status,
  secondary,
  highlight = false,
  compact,
  testID,
}: {
  overline: string;
  title: string;
  cando?: string;
  level: string;
  actionLabel?: string;
  actionIcon?: IconName;
  onAction?: () => void;
  status?: BannerStatus;
  secondary?: BannerAction;
  /** The learner's current unit: a soft halo in the level colour, like the current node's. */
  highlight?: boolean;
  compact?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const t = tone(theme, levelTone(level));
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: compact ? 12 : 16,
        paddingStart: compact ? 16 : 20,
        paddingEnd: compact ? 14 : 16,
        marginBottom: 6,
        borderRadius: radius.lg,
        backgroundColor: t.c,
        boxShadow: [theme.lip(t.lip, 6), highlight ? `0px 0px 0px 4px ${theme.c['bg-soft']}, 0px 0px 0px 8px ${t.soft}` : null].filter(Boolean).join(', '),
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View accessible accessibilityRole="header" style={{ gap: 2 }}>
          <Txt variant="overline" rawColor={t.on}>
            {overline}
          </Txt>
          <Txt variant="title-l" rawColor={t.on} style={compact ? { fontSize: 20, lineHeight: 25 } : { fontSize: 26, lineHeight: 31 }}>
            {title}
          </Txt>
          {cando ? (
            <Txt variant="body-s" weight={700} rawColor={t.on} style={{ fontSize: 15, lineHeight: 20 }}>
              {cando}
            </Txt>
          ) : null}
        </View>
        {status || secondary ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 }}>
            {status ? (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28, paddingHorizontal: 10, borderRadius: radius.full, backgroundColor: theme.c.surface }}
                testID={testID ? `${testID}-status` : undefined}
              >
                <Icon name={status.icon} size={15} color={t.ink} />
                <Txt variant="caption" weight={900} rawColor={t.ink} style={{ fontSize: 13, lineHeight: 16 }}>
                  {status.label}
                </Txt>
              </View>
            ) : null}
            {secondary ? (
              <Pressable
                onPress={secondary.onPress}
                accessibilityRole="button"
                accessibilityLabel={secondary.accessibilityLabel}
                hitSlop={8}
                testID={secondary.testID}
                style={(s: State) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  minHeight: 32,
                  paddingHorizontal: 11,
                  borderRadius: radius.full,
                  borderWidth: 2,
                  borderColor: t.on,
                  opacity: s.pressed ? 0.7 : 1,
                  boxShadow: s.focused ? theme.focusRing : 'none',
                })}
              >
                <Icon name={secondary.icon} size={15} color={t.on} />
                <Txt variant="caption" weight={900} rawColor={t.on} style={{ fontSize: 13, lineHeight: 16 }}>
                  {secondary.label}
                </Txt>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel}: ${title}`}
          style={(s: State) => ({
            width: 64,
            height: 64,
            borderRadius: 16,
            borderWidth: 2,
            borderColor: t.on,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            opacity: s.pressed ? 0.7 : 1,
            boxShadow: s.focused ? theme.focusRing : 'none',
          })}
        >
          <Icon name={actionIcon} size={24} color={t.on} />
          <Txt variant="caption" weight={900} rawColor={t.on} style={{ fontSize: 12 }}>
            {actionLabel}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}
