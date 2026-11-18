import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import type { QuestOut } from '@/api/types';
import { Icon, Txt, radius, tone, useTheme } from '@/design';
import { questLook, questTitle } from '@/features/hud/format';
import { usePrefs } from '@/state/prefs';

/**
 * One quest (docs/16 E10): an icon tile in the skill colour, the title, a bar n/target and the
 * gem reward; a completed quest gets a success check. The bar can fill from `before` (the lesson
 * summary animates it, 600 ms); reduced motion shows the end state. No countdown, ever.
 */
export const QuestRow = memo(function QuestRow({
  quest,
  before = quest.progress,
  animate = false,
  delayMs = 0,
  compact = false,
}: {
  quest: QuestOut;
  before?: number;
  animate?: boolean;
  delayMs?: number;
  compact?: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const lang = usePrefs((s) => s.interfaceLanguage);
  const title = questTitle(quest, lang);
  const look = questLook(quest.metric);
  const tn = tone(theme, look.tone);
  const target = Math.max(1, quest.target);
  const done = quest.completed;
  const to = done ? 1 : Math.min(1, quest.progress / target);
  const from = Math.min(to, Math.max(0, before / target));
  const moving = animate && !theme.reduceMotion && from !== to;
  const fill = useSharedValue(moving ? from : to);
  useEffect(() => {
    fill.value = moving ? withDelay(delayMs, withTiming(to, { duration: 600, easing: Easing.out(Easing.cubic) })) : to;
  }, [to, moving, delayMs, fill]);
  const bar = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  const label = done ? t('quests.rowDoneA11y', { title, gems: quest.gems }) : t('quests.rowA11y', { title, progress: Math.min(quest.progress, quest.target), target: quest.target, gems: quest.gems });
  const tile = compact ? 32 : 40;

  return (
    <View accessible accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: compact ? 48 : 56 }} testID={`quest-${quest.id}`}>
      <View style={{ width: tile, height: tile, borderRadius: 12, backgroundColor: done ? theme.c['success-soft'] : tn.soft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={done ? 'check' : look.icon} size={compact ? 18 : 22} color={done ? theme.c['success-ink'] : tn.ink} strokeWidth={done ? 3 : 2.2} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt variant="body-s" weight={800} style={{ flex: 1 }} numberOfLines={2}>
            {title}
          </Txt>
          <Txt variant="caption" weight={800} color="ink-3">
            {`${Math.min(quest.progress, quest.target)}/${quest.target}`}
          </Txt>
        </View>
        <View style={{ height: 8, borderRadius: radius.full, backgroundColor: theme.c.line, overflow: 'hidden' }}>
          <Animated.View style={[{ height: 8, borderRadius: radius.full, backgroundColor: done ? theme.c.success : tn.c }, bar]} />
        </View>
      </View>
      {quest.gems > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, minHeight: 26, borderRadius: radius.full, backgroundColor: theme.c['gem-soft'] }}>
          <Icon name="gem" tone="color" size={14} />
          <Txt variant="caption" weight={900} rawColor={theme.c['gem-ink']} style={{ fontSize: 12 }}>
            {t('quests.reward', { count: quest.gems })}
          </Txt>
        </View>
      ) : null}
    </View>
  );
});
