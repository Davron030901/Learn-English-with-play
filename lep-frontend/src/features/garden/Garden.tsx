import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type PressableStateCallbackType } from 'react-native';

import { useGardenSummary } from '@/api/queries/gamification';
import type { Plant } from '@/api/types';
import { useCourse } from '@/content/queries';
import { Button, Card, Mascot, Notice, PendingStat, SectionTitle, Segmented, Switch, TextLink, Txt, radius, useTheme } from '@/design';
import { serverState } from '@/features/progress/serverState';
import { isOnline, useOnlineStore } from '@/state/online';
import { usePrefs } from '@/state/prefs';

import { BedPages, type BedView } from './GardenBed';
import { GROWTH_STAGES, PlantArt, plantPalette, type PlantPalette, type PlantStage } from './PlantArt';
import { PlantSheet } from './PlantSheet';
import { useWatering } from './watering';

type State = PressableStateCallbackType & { focused?: boolean };

/** How long the "watered" note and the watering animation stay after a review. */
const WATERED_NOTE_MS = 15_000;

function StageTile({ stage, count, selected, palette, onPress }: { stage: PlantStage; count: number; selected: boolean; palette: PlantPalette; onPress: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const name = t(`garden.stageName.${stage}`);
  const label = t(`garden.stage.${stage}`);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={t('garden.stageTile', { stage: `${name} (${label})`, count })}
      testID={`stage-${stage}`}
      style={(s: State) => ({
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
        gap: 2,
        paddingVertical: 6,
        borderRadius: radius.md,
        borderWidth: 2,
        borderColor: selected ? theme.c.primary : 'transparent',
        backgroundColor: selected ? theme.c['primary-soft'] : s.pressed ? theme.c['bg-soft'] : 'transparent',
        boxShadow: s.focused ? theme.focusRing : 'none',
      })}
    >
      <PlantArt stage={stage} seedKey={`tile-${stage}`} palette={palette} size={30} />
      <Txt variant="stat-s" style={{ fontSize: 17, lineHeight: 20 }}>
        {String(count)}
      </Txt>
      <Txt variant="caption" color="ink-2" weight={800} numberOfLines={1} style={{ fontSize: 11, lineHeight: 13 }}>
        {name}
      </Txt>
    </Pressable>
  );
}

/**
 * The Word Garden (docs/16 E09): the review hub. Every number on it is the server's — how many
 * words are due and the minutes that takes, the stage counts, each plant's stage and due date.
 * Watering starts a review the scheduler composed; a healthy plant cannot be watered on demand.
 * Offline or on a server without the garden, the screen says so instead of guessing.
 */
export function Garden() {
  const { t } = useTranslation();
  const theme = useTheme();
  const palette = useMemo(() => plantPalette(theme), [theme]);
  const summary = useGardenSummary();
  const state = serverState(summary);
  const online = useOnlineStore(isOnline);
  const course = useCourse();
  const language = usePrefs((s) => s.interfaceLanguage);
  const watering = useWatering((s) => s.last);
  const clearWatering = useWatering((s) => s.clear);
  const [filter, setFilter] = useState<PlantStage | null>(null);
  const [view, setView] = useState<'garden' | 'list'>('garden');
  const [showWord, setShowWord] = useState(false);
  const [sheet, setSheet] = useState<{ plant: Plant; bed: string } | null>(null);

  useEffect(() => {
    if (!watering) return;
    const id = setTimeout(clearWatering, WATERED_NOTE_MS);
    return () => clearTimeout(id);
  }, [watering, clearWatering]);

  const watered = useMemo(() => new Set(watering?.plants ?? []), [watering]);
  const onOpen = useCallback((plant: Plant, bed: string) => setSheet({ plant, bed }), []);
  const unitTitle = useCallback(
    (unitId: string, serverTitle: Readonly<Record<string, string>>) => {
      const outline = course.data?.unitsById.get(unitId);
      const title = serverTitle[language] ?? serverTitle.en ?? outline?.title.en ?? unitId;
      return outline ? t('garden.bedTitle', { n: outline.index, title }) : title;
    },
    [course.data, language, t],
  );
  const ctx = useMemo<BedView>(
    () => ({ view, showWord, filter, watered, palette, reduceMotion: theme.reduceMotion, onOpen, unitTitle }),
    [view, showWord, filter, watered, palette, theme.reduceMotion, onOpen, unitTitle],
  );

  if (state === 'loading') {
    return (
      <Card>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }} accessibilityLiveRegion="polite">
          <Mascot pose="think" size={56} />
          <Txt variant="body-m" color="ink-3" style={{ flex: 1 }}>
            {t('common.loading')}
          </Txt>
        </View>
      </Card>
    );
  }

  if (state === 'unavailable' || !summary.data) {
    return (
      <View style={{ gap: 8 }} testID="garden-unavailable">
        <PendingStat icon="cards" tone="green" title={t('garden.title')} body={t('garden.unavailable')} />
        {summary.isError ? (
          <TextLink icon="refresh" onPress={() => void summary.refetch()}>
            {t('common.tryAgain')}
          </TextLink>
        ) : null}
      </View>
    );
  }

  const g = summary.data;
  const count = (s: string) => g.stages[s] ?? 0;
  const planted = Object.values(g.stages).reduce((a, b) => a + b, 0);
  const leeches = count('leech');
  const due = g.due_count;

  return (
    <View style={{ gap: 20 }} testID="garden">
      <Card>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <Mascot pose={due > 0 ? 'wave' : 'happy'} size={72} />
          <View style={{ flex: 1, gap: 4 }} accessibilityLiveRegion="polite">
            {planted === 0 ? (
              <Txt variant="body-m" color="ink-2" testID="garden-empty">
                {t('garden.empty')}
              </Txt>
            ) : due > 0 ? (
              <Txt variant="title-s" testID="garden-weather">
                {t('garden.weather', { count: due, minutes: Math.max(1, g.est_minutes) })}
              </Txt>
            ) : (
              <Txt variant="title-s" testID="garden-watered">
                {t('garden.allWatered')}
              </Txt>
            )}
          </View>
        </View>
        {due > 0 ? (
          <>
            <Button
              size="lg"
              block
              icon="play"
              disabled={!online}
              accessibilityHint={t('garden.waterHint')}
              onPress={() => router.push('/review')}
              testID="water"
            >
              {t('garden.water', { count: due, minutes: Math.max(1, g.est_minutes) })}
            </Button>
            {!online ? (
              <Txt variant="caption" color="ink-3">
                {t('garden.needsConnection')}
              </Txt>
            ) : null}
          </>
        ) : planted > 0 ? (
          <Button variant="secondary" block icon="book" onPress={() => router.push('/library')} testID="garden-library">
            {t('garden.toLibrary')}
          </Button>
        ) : null}
      </Card>

      {watering ? (
        <View accessibilityLiveRegion="polite" testID="garden-watered-note">
          <Notice icon="check" tone="lagoon">
            {t('garden.watered', { count: watering.plants.length })}
          </Notice>
        </View>
      ) : null}

      {planted > 0 ? (
        <Card>
          <SectionTitle>{t('garden.stagesTitle')}</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {GROWTH_STAGES.map((st) => (
              <StageTile key={st} stage={st} count={count(st)} selected={filter === st} palette={palette} onPress={() => setFilter((f) => (f === st ? null : st))} />
            ))}
          </View>
          <Txt variant="caption" color="ink-3">
            {g.audited ? t('garden.stagesAudited') : t('garden.stagesCaption')}
          </Txt>
        </Card>
      ) : null}

      {leeches > 0 ? (
        <Pressable
          onPress={() => setFilter((f) => (f === 'leech' ? null : 'leech'))}
          accessibilityRole="button"
          accessibilityState={{ selected: filter === 'leech' }}
          testID="garden-tricky"
          style={(s: State) => ({
            flexDirection: 'row',
            gap: 12,
            alignItems: 'center',
            padding: 14,
            borderRadius: radius.lg,
            borderWidth: 2,
            borderColor: filter === 'leech' ? theme.c.purple : 'transparent',
            backgroundColor: theme.c['purple-soft'],
            boxShadow: s.focused ? theme.focusRing : 'none',
          })}
        >
          <PlantArt stage="leech" seedKey="tricky" palette={palette} size={40} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="body-m" weight={800} rawColor={theme.c['purple-ink']}>
              {t('garden.tricky', { count: leeches })}
            </Txt>
            <Txt variant="body-s" color="ink-2">
              {t('garden.trickyBody')}
            </Txt>
          </View>
        </Pressable>
      ) : null}

      {planted > 0 ? (
        <View style={{ gap: 12 }}>
          <SectionTitle>{t('garden.bedsTitle')}</SectionTitle>
          <Txt variant="caption" color="ink-3">
            {t('garden.explainer')}
          </Txt>
          <Segmented<'garden' | 'list'>
            label={t('garden.viewLabel')}
            showLabel={false}
            value={view}
            onChange={setView}
            options={[
              { value: 'garden', label: t('garden.viewGarden') },
              { value: 'list', label: t('garden.viewList') },
            ]}
            testID="garden-view"
          />
          {view === 'garden' ? <Switch label={t('garden.showWords')} value={showWord} onValueChange={setShowWord} testID="garden-show-words" /> : null}
          {filter ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <Txt variant="body-s" weight={800} color="ink-2" style={{ flexShrink: 1 }}>
                {t('garden.filterOn', { stage: t(`garden.stage.${filter}`) })}
              </Txt>
              <TextLink onPress={() => setFilter(null)}>{t('garden.filterAll')}</TextLink>
            </View>
          ) : null}
          <BedPages cursor={0} ctx={ctx} />
        </View>
      ) : null}

      <PlantSheet plant={sheet?.plant ?? null} bedTitle={sheet?.bed ?? ''} palette={palette} onClose={() => setSheet(null)} />
    </View>
  );
}
