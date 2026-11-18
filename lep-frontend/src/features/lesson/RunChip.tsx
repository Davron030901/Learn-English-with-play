import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import { Icon, Mascot, Txt, radius, useTheme, type MascotPose } from '@/design';

/** How long the run chip holds before it fades (docs/16 E05 §3). */
export const RUN_HOLD_MS = 1_400;
const FADE_MS = 200;

/**
 * The in-lesson run (docs/16 E05): at 5, 10, 15… right answers in a row a small chip rises 12 px
 * near the progress bar during feedback — a bolt and "5 in a row" — holds 1.4 s and fades. It is
 * announced politely to screen readers. It changes nothing about scoring: no multiplier, and a
 * wrong answer simply ends the run without a word. Lives outside design/Exercise.tsx on purpose.
 * The runner keys it per milestone, so each one starts fresh.
 */
export const RunChip = memo(function RunChip({ count, show }: { count: number; show: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();
  // Set once the chip has held and faded; until then it shows whenever asked to.
  const [over, setOver] = useState(false);
  const visible = show && count > 0 && !over;
  const life = useSharedValue(0);

  useEffect(() => {
    if (!show || count <= 0) return;
    AccessibilityInfo.announceForAccessibility(t('run.a11y', { count }));
    const rise = theme.reduceMotion ? 0 : 180;
    life.value = withSequence(withTiming(1, { duration: rise || 1, easing: Easing.out(Easing.cubic) }), withDelay(RUN_HOLD_MS, withTiming(0, { duration: FADE_MS })));
    const id = setTimeout(() => setOver(true), rise + RUN_HOLD_MS + FADE_MS);
    return () => clearTimeout(id);
  }, [show, count, life, t, theme.reduceMotion]);

  const reduce = theme.reduceMotion;
  const style = useAnimatedStyle(() => ({ opacity: life.value, transform: [{ translateY: reduce ? 0 : 12 * (1 - life.value) }] }));

  if (!visible) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('run.a11y', { count })}
      testID="run-chip"
      style={[
        {
          position: 'absolute',
          top: 58,
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: radius.full,
          backgroundColor: theme.c['xp-soft'],
          borderWidth: 2,
          borderColor: theme.c.xp,
          boxShadow: theme.lip(theme.c['xp-lip'], 2),
          zIndex: 5,
        },
        style,
      ]}
    >
      <Icon name="bolt" tone="color" size={18} />
      <Txt variant="label" weight={900} rawColor={theme.c['xp-ink']} style={{ fontSize: 15, lineHeight: 18 }}>
        {t('run.chip', { count })}
      </Txt>
    </Animated.View>
  );
});

/**
 * Mini Pip beside the lesson's progress bar (docs/16 E06 §3, E05 §4): listening on speaking items,
 * happy after a right answer (one small bob), thinking after a wrong one — curious, never sad —
 * cheering on a run, resting on a break. Static between items; decorative for screen readers.
 */
export const LessonPip = memo(function LessonPip({ pose, bobKey }: { pose: MascotPose; bobKey: number }) {
  const theme = useTheme();
  const y = useSharedValue(0);
  useEffect(() => {
    if (theme.reduceMotion || bobKey < 0) return;
    y.value = withSequence(withTiming(-3, { duration: 120 }), withTiming(0, { duration: 160 }));
  }, [bobKey, theme.reduceMotion, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <View style={{ width: 32, alignItems: 'center', marginEnd: 12 }} testID={`lesson-pip-${pose}`} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View style={style}>
        <Mascot pose={pose} size={28} />
      </Animated.View>
    </View>
  );
});
