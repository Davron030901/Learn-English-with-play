import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type PressableStateCallbackType } from 'react-native';

import { useEquippedOutfit } from '@/api/queries/assessment';
import type { QuestOut } from '@/api/types';
import { Chip, Icon, Txt, radius, useTheme } from '@/design';
import { DressedPip } from '@/design/Outfits';
import { readJson, writeJson } from '@/state/storage';

import { QuestRow } from './QuestRow';

type State = PressableStateCallbackType & { focused?: boolean };

const OPEN_KEY = 'lep:ui:quests-open';
/** Remembered per device (docs/16 E10 §1); read once per app run. */
let openCache: boolean | null = null;

function useRememberedOpen(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(openCache ?? false);
  useEffect(() => {
    if (openCache !== null) return;
    let alive = true;
    void readJson<boolean>(OPEN_KEY, false).then((v) => {
      openCache = v;
      if (alive) setOpen(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return [
    open,
    (v) => {
      openCache = v;
      setOpen(v);
      void writeJson(OPEN_KEY, v).catch(() => undefined);
    },
  ];
}

/**
 * "Today's quests" on the path (docs/16 E10, E18): the day's three and the week's two, from the
 * server's summary. Collapsible, the choice remembered on this device. Without the server it says
 * so plainly — no quest is ever invented on the device.
 */
export function QuestsCard({ daily, weekly, available }: { daily: readonly QuestOut[]; weekly: readonly QuestOut[]; available: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useRememberedOpen();
  const outfit = useEquippedOutfit();
  const done = daily.filter((q) => q.completed).length;
  const total = daily.length;
  const allDone = total > 0 && done === total;
  const hasQuests = available && total + weekly.length > 0;

  return (
    <View
      testID="quests-card"
      style={{ borderRadius: radius.lg, borderWidth: 2, borderColor: theme.c.line, backgroundColor: theme.c.surface, paddingHorizontal: 14, paddingVertical: 4 }}
    >
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={hasQuests ? `${t('quests.today')}, ${t('quests.count', { done, total })}` : t('quests.today')}
        accessibilityHint={open ? t('quests.hide') : t('quests.show')}
        testID="quests-toggle"
        style={(s: State) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderRadius: 12, boxShadow: s.focused ? theme.focusRing : 'none' })}
      >
        <Icon name="target" size={20} color={theme.c['primary-ink']} />
        <Txt variant="body-m" weight={900} style={{ flex: 1 }} numberOfLines={1}>
          {t('quests.today')}
        </Txt>
        {hasQuests ? (
          <View style={{ flexDirection: 'row', gap: 4 }} accessible={false}>
            {daily.map((q) => (
              <View
                key={q.id}
                style={{ width: 10, height: 10, borderRadius: radius.full, backgroundColor: q.completed ? theme.c.success : 'transparent', borderWidth: 2, borderColor: q.completed ? theme.c.success : theme.c.edge }}
              />
            ))}
          </View>
        ) : (
          <Chip size="sm" icon="clock">
            {t('common.notAvailableYet')}
          </Chip>
        )}
        <Icon name="chevron-down" size={20} color={theme.c['ink-3']} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </Pressable>
      {open ? (
        <View style={{ gap: 6, paddingBottom: 10 }} testID="quests-body">
          {!hasQuests ? (
            <Txt variant="body-s" color="ink-2">
              {t('quests.unavailable')}
            </Txt>
          ) : (
            <>
              {daily.map((q) => (
                <QuestRow key={q.id} quest={q} compact />
              ))}
              {allDone ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <DressedPip outfit={outfit} pose="cheer" size={32} />
                  <Txt variant="body-s" weight={800} color="success-ink" style={{ flex: 1 }}>
                    {t('quests.allDone')}
                  </Txt>
                </View>
              ) : null}
              {weekly.length ? (
                <>
                  <Txt variant="overline" color="ink-3" style={{ marginTop: 6 }} accessibilityRole="header">
                    {t('quests.week')}
                  </Txt>
                  {weekly.map((q) => (
                    <QuestRow key={q.id} quest={q} compact />
                  ))}
                </>
              ) : null}
              <Txt variant="caption" color="ink-3">
                {t('quests.footer')}
              </Txt>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}
