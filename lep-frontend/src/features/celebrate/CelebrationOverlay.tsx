import { useEffect, useEffectEvent, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Modal, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEquippedOutfit } from '@/api/queries/assessment';
import { sfx } from '@/audio/sfx';
import { useCourse } from '@/content/queries';
import { Button, Icon, Txt, levelTone, tone, useTheme } from '@/design';
import { DressedPip } from '@/design/Outfits';
import { CountUp } from '@/features/hud/CountUp';
import { PlaceBand } from '@/features/path/PlaceBand';
import { usePrefs } from '@/state/prefs';

import { Confetti } from './Confetti';
import type { Celebration } from './queue';
import { Stamp } from './Stamp';

const MILESTONES = new Set([7, 30, 100, 365]);
const MAX_STAMPS = 6;

interface CelebrationView {
  title: string;
  sub: string | null;
  level: string;
  stamps: { key: string; text: string }[];
  more: number;
  next: { n: number; cefr: string } | null;
}

/** "S01U03" → 3, "S04" → 4: the number when the course outline has not loaded. */
const numberIn = (id: string, re: RegExp) => Number(re.exec(id)?.[1] ?? 0);

/**
 * One rare celebration, full screen (docs/16 E12): Pip cheering, a title, and the moment itself —
 * the unit's can-do stamps landing one by one, the next place arriving for a section, or the
 * flame growing for a streak milestone. Confetti only for a section and a year-long streak, and
 * never in "calm" or with reduced motion. "Continue" is there from the first frame: nothing is
 * forced to play out.
 */
export function CelebrationOverlay({ celebration: c, onDone }: { celebration: Celebration; onDone: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const calm = usePrefs((s) => s.celebrations) === 'calm';
  const course = useCourse().data;
  const outfit = useEquippedOutfit();
  const { width } = useWindowDimensions();
  const quiet = calm || theme.reduceMotion;
  /** Gap between stamps: 250 ms (docs/16 E12), squeezed so a calm sequence stays ≤ 1.2 s. */
  const stampGap = quiet ? 120 : 250;

  const view = useMemo<CelebrationView>(() => {
    switch (c.kind) {
      case 'unit': {
        const unit = course?.unitsById.get(c.unitId);
        const n = unit?.index ?? numberIn(c.unitId, /U(\d+)/);
        const texts = c.badges.length ? c.badges.map((b) => ({ key: b.id, text: b.text })) : (unit?.canDo ?? []).map((text, i) => ({ key: `${c.unitId}:${i}`, text }));
        return { title: t('celebrate.unit.title', { n }), sub: texts.length ? t('celebrate.unit.canNow') : null, level: unit?.cefr ?? 'A1', stamps: texts, more: 0, next: null };
      }
      case 'stamps': {
        const shown = c.badges.slice(0, MAX_STAMPS);
        const level = course?.unitsById.get(shown[0]?.unit_id ?? '')?.cefr ?? 'A1';
        return { title: t('celebrate.stamps.title'), sub: null, level, stamps: shown.map((b) => ({ key: b.id, text: b.text })), more: c.badges.length - shown.length, next: null };
      }
      case 'section': {
        const n = numberIn(c.sectionId, /(\d+)/);
        const next = course?.sections[n];
        const place = next ? t(`hud.places.${n + 1}`, { defaultValue: '' }) : '';
        return {
          title: t('celebrate.section.title', { n }),
          sub: place ? t('celebrate.section.nextStop', { place }) : t('celebrate.section.finale'),
          level: next?.cefr ?? course?.sections[n - 1]?.cefr ?? 'A1',
          stamps: [],
          more: 0,
          next: next ? { n: n + 1, cefr: next.cefr } : null,
        };
      }
      case 'streak':
        return {
          title: t('celebrate.streak.title', { count: c.days }),
          sub: MILESTONES.has(c.days) ? t(`celebrate.streak.${c.days}`) : t('celebrate.streak.other'),
          level: 'A1',
          stamps: [],
          more: 0,
          next: null,
        };
    }
  }, [c, course, t]);

  // Sound and the screen-reader announcement, once per celebration.
  const play = useEffectEvent(() => {
    AccessibilityInfo.announceForAccessibility(t('celebrate.announce', { title: view.title }));
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, f: () => void) => timers.push(setTimeout(f, ms));
    switch (c.kind) {
      case 'unit':
      case 'stamps': {
        if (c.kind === 'unit') sfx('complete');
        const first = c.kind === 'unit' ? 450 : 150;
        if (quiet) {
          if (view.stamps.length) later(first + 260, () => sfx('stamp'));
        } else {
          view.stamps.forEach((_, i) => later(first + i * stampGap + 260, () => sfx('stamp')));
        }
        break;
      }
      case 'section':
        if (!quiet) sfx('whoosh');
        later(quiet ? 0 : 600, () => sfx('levelup'));
        break;
      case 'streak':
        sfx(c.days >= 100 ? 'levelup' : 'streak');
        break;
    }
    return () => timers.forEach(clearTimeout);
  });
  useEffect(() => play(), [c.key]);

  // Pip springs in; the section's next place slides in from the end; a milestone flame grows.
  const enter = useSharedValue(theme.reduceMotion ? 1 : 0);
  useEffect(() => {
    if (theme.reduceMotion) return;
    enter.value = calm ? withTiming(1, { duration: 300 }) : withSpring(1, { damping: 12, stiffness: 220 });
  }, [enter, calm, theme.reduceMotion]);
  const pipStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, enter.value * 1.5), transform: [{ scale: 0.6 + 0.4 * enter.value }] }));

  const slide = useSharedValue(quiet ? 0 : 1);
  useEffect(() => {
    if (quiet) return;
    slide.value = withDelay(250, withTiming(0, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [slide, quiet]);
  const slideStyle = useAnimatedStyle(() => ({ opacity: 1 - slide.value * 0.8, transform: [{ translateX: slide.value * width }] }));

  const grow = useSharedValue(quiet ? 1 : 0.45);
  useEffect(() => {
    if (quiet) return;
    grow.value = withDelay(200, withSpring(1, { damping: 10, stiffness: 120 }));
  }, [grow, quiet]);
  const flameStyle = useAnimatedStyle(() => ({ transform: [{ scale: grow.value }] }));

  const confettiTone = tone(theme, levelTone(view.level));
  const confettiColors = useMemo(
    () => [confettiTone.c, confettiTone.lip, confettiTone.soft, theme.c.yellow, theme.c.xp],
    [confettiTone.c, confettiTone.lip, confettiTone.soft, theme.c.yellow, theme.c.xp],
  );
  const confetti = (c.kind === 'section' || (c.kind === 'streak' && c.days >= 365)) && !quiet;
  const unitTone = tone(theme, levelTone(view.level));

  return (
    <Modal visible transparent={false} animationType={theme.reduceMotion ? 'none' : 'fade'} onRequestClose={onDone} statusBarTranslucent>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.c.bg }} testID={`celebration-${c.kind}`} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 18, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          <Animated.View style={[{ alignItems: 'center' }, pipStyle]}>
            <DressedPip outfit={outfit} pose="cheer" size={120} />
          </Animated.View>
          {c.kind === 'unit' ? (
            <View style={{ alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 14, backgroundColor: unitTone.c, boxShadow: theme.lip(unitTone.lip, 4) }}>
              <Txt variant="label" weight={900} rawColor={unitTone.on}>
                {view.level}
              </Txt>
            </View>
          ) : null}
          <Txt variant="display-m" align="center" accessibilityRole="header" testID="celebration-title">
            {view.title}
          </Txt>
          {c.kind === 'streak' ? (
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Animated.View style={flameStyle}>
                <Icon name="flame" tone="color" size={160} />
              </Animated.View>
              <View accessible accessibilityLabel={t('hud.streak.label', { count: c.days })}>
                <CountUp value={c.days} from={Math.max(0, c.days - 1)} animate={!quiet} durationMs={500} variant="display-l" rawColor={theme.c['streak-ink']} align="center" />
              </View>
            </View>
          ) : null}
          {view.sub ? (
            <Txt variant="title-s" color="ink-2" align="center">
              {view.sub}
            </Txt>
          ) : null}
          {view.stamps.length ? (
            <View style={{ gap: 14 }} testID="celebration-stamp-list">
              {view.stamps.map((s, i) => (
                <Stamp key={s.key} text={s.text} level={view.level} index={i} delayMs={(c.kind === 'unit' ? 450 : 150) + i * stampGap} testID={`stamp-${i}`} />
              ))}
              {view.more > 0 ? (
                <Txt variant="body-s" color="ink-3">
                  {t('celebrate.stamps.more', { count: view.more })}
                </Txt>
              ) : null}
            </View>
          ) : null}
          {c.kind === 'section' && view.next ? (
            <Animated.View style={slideStyle}>
              <PlaceBand n={view.next.n} cefr={view.next.cefr} height={128} />
            </Animated.View>
          ) : null}
          <Button size="lg" block onPress={onDone} testID="celebration-continue">
            {t('common.continue')}
          </Button>
        </ScrollView>
        {confetti ? <Confetti colors={confettiColors} count={c.kind === 'section' ? 40 : 60} seed={c.key.length} /> : null}
      </SafeAreaView>
    </Modal>
  );
}
