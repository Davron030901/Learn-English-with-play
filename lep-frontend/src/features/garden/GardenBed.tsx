import type { TFunction } from 'i18next';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type PressableStateCallbackType, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';

import { useGardenBeds } from '@/api/queries/gamification';
import type { Plant } from '@/api/types';
import { Button, Txt, radius, useTheme } from '@/design';

import { mix } from './colour';
import { BEND, PlantArt, thirstOf, varietyOf, type PlantPalette, type PlantStage } from './PlantArt';

type State = PressableStateCallbackType & { focused?: boolean };

const DAY_MS = 86_400_000;
export const CELL_W = 44;
const FILL: ViewStyle = { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 };

/** "needs water" / "next review in 12 days" — read from the server's due date, never computed R. */
export function plantStatus(t: TFunction, plant: Plant, now: number): string {
  const thirst = thirstOf(plant);
  if (thirst === 'dry') return t('garden.statusDry');
  if (thirst === 'thirsty') return t('garden.statusDue');
  const days = Math.ceil((Date.parse(plant.due_at) - now) / DAY_MS);
  return days >= 1 ? t('garden.statusNext', { count: days }) : t('garden.statusToday');
}

export function plantLabel(t: TFunction, plant: Plant, now: number): string {
  return t('garden.plantA11y', { word: plant.lemma, stage: t(`garden.stage.${plant.stage}`), status: plantStatus(t, plant, now) });
}

// ---------------------------------------------------------------- watering animation
function Drop({ k, progress, color }: { k: number; progress: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const local = Math.min(1, Math.max(0, (progress.value - k * 0.08) / 0.6));
    return { opacity: local >= 1 ? 0 : 1 - local * 0.5, transform: [{ translateY: local * 24 }] };
  });
  return <Animated.View style={[{ position: 'absolute', top: 2, start: 11 + k * 5, width: 4, height: 5, borderRadius: 2.5, backgroundColor: color }, style]} />;
}

/**
 * A plant this visit's review just watered: five drops fall 24 px, then the stem springs upright
 * from its thirsty lean (damping 10). Played once, only with motion allowed (docs/16 E09 §7).
 */
function WateredPlant({ plant, palette }: { plant: Plant; palette: PlantPalette }) {
  const lean = varietyOf(plant.lexeme_id).lean;
  const tilt = useSharedValue(BEND.thirsty * lean * (plant.stage === 'tree' ? 0.5 : 1));
  const drops = useSharedValue(0);
  useEffect(() => {
    drops.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.quad) });
    tilt.value = withDelay(250, withSpring(0, { damping: 10, stiffness: 140 }));
  }, [drops, tilt]);
  const plantStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.value}deg` }] }));
  const origin = plant.stage === 'tree' ? '50% 69.6%' : '50% 83.9%';
  return (
    <View style={{ width: CELL_W, height: 56 }}>
      <View style={FILL}>
        <PlantArt stage={plant.stage} seedKey={plant.lexeme_id} palette={palette} layer="ground" />
      </View>
      <Animated.View style={[FILL, { transformOrigin: origin }, plantStyle]}>
        <PlantArt stage={plant.stage} seedKey={plant.lexeme_id} palette={palette} layer="plant" />
      </Animated.View>
      {[0, 1, 2, 3, 4].map((k) => (
        <Drop key={k} k={k} progress={drops} color={palette.water} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- one plant
interface CellProps {
  plant: Plant;
  palette: PlantPalette;
  showWord: boolean;
  watered: boolean;
  reduceMotion: boolean;
  label: string;
  onOpen: (plant: Plant) => void;
}

export const PlantCell = memo(function PlantCell({ plant, palette, showWord, watered, reduceMotion, label, onOpen }: CellProps) {
  const theme = useTheme();
  const thirst = thirstOf(plant);
  // The animation waits for the server to confirm the watering (the plant is no longer due).
  const animate = watered && thirst === 'fresh' && !reduceMotion;
  return (
    <Pressable
      onPress={() => onOpen(plant)}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`plant-${plant.lexeme_id}`}
      style={(s: State) => ({ width: CELL_W, minHeight: 56, alignItems: 'center', borderRadius: 10, opacity: s.pressed ? 0.7 : 1, boxShadow: s.focused ? theme.focusRing : 'none' })}
    >
      {animate ? <WateredPlant plant={plant} palette={palette} /> : <PlantArt stage={plant.stage} thirst={thirst} seedKey={plant.lexeme_id} palette={palette} />}
      {showWord ? (
        <Txt variant="caption" lang="en" numberOfLines={1} align="center" style={{ fontSize: 11, lineHeight: 13, width: CELL_W + 4 }}>
          {plant.lemma}
        </Txt>
      ) : null}
    </Pressable>
  );
});

/** The accessible list form of a plant: "hello · Known · next review in 12 days". */
const PlantRow = memo(function PlantRow({ plant, palette, label, status, onOpen }: { plant: Plant; palette: PlantPalette; label: string; status: string; onOpen: (plant: Plant) => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const thirst = thirstOf(plant);
  return (
    <Pressable
      onPress={() => onOpen(plant)}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`plant-row-${plant.lexeme_id}`}
      style={(s: State) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 48,
        paddingVertical: 4,
        paddingHorizontal: 6,
        borderRadius: 12,
        backgroundColor: s.pressed ? theme.c['bg-soft'] : 'transparent',
        boxShadow: s.focused ? theme.focusRing : 'none',
      })}
    >
      <PlantArt stage={plant.stage} thirst={thirst} seedKey={plant.lexeme_id} palette={palette} size={32} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="body-m" weight={800} lang="en" numberOfLines={1}>
          {plant.lemma}
        </Txt>
        <Txt variant="caption" color="ink-3" numberOfLines={2}>
          {`${t(`garden.stage.${plant.stage}`)} · ${status}`}
        </Txt>
      </View>
    </Pressable>
  );
});

// ---------------------------------------------------------------- one bed (a unit)
export interface BedView {
  view: 'garden' | 'list';
  showWord: boolean;
  filter: PlantStage | null;
  watered: ReadonlySet<string>;
  palette: PlantPalette;
  reduceMotion: boolean;
  onOpen: (plant: Plant, bedTitle: string) => void;
  /** Unit number and title from the course outline (content), when known. */
  unitTitle: (unitId: string, serverTitle: Readonly<Record<string, string>>) => string;
}

export const GardenBedCard = memo(function GardenBedCard({ unitId, title, plants, ctx }: { unitId: string; title: Readonly<Record<string, string>>; plants: readonly Plant[]; ctx: BedView }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [now] = useState(() => Date.now());
  const heading = ctx.unitTitle(unitId, title);
  const shown = ctx.filter ? plants.filter((pl) => pl.stage === ctx.filter) : plants;
  if (shown.length === 0) return null;
  const thirsty = plants.filter((pl) => pl.thirsty).length;
  const open = (plant: Plant) => ctx.onOpen(plant, heading);
  const bedFill = theme.c['orange-soft'];
  const bedLip = mix(theme.c['orange-soft'], theme.c['orange-lip'], 0.45);
  return (
    <View style={{ gap: 8 }} testID={`bed-${unitId}`}>
      <View style={{ gap: 2 }} accessibilityRole="header">
        <Txt variant="title-s" numberOfLines={2}>
          {heading}
        </Txt>
        <Txt variant="caption" color="ink-3">
          {t('garden.bedCounts', { planted: plants.length, thirsty })}
        </Txt>
      </View>
      {ctx.view === 'garden' ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 4,
            padding: 8,
            borderRadius: radius.md,
            backgroundColor: bedFill,
            boxShadow: theme.lip(bedLip, 3),
            marginBottom: 3,
          }}
        >
          {shown.map((pl) => (
            <PlantCell
              key={pl.lexeme_id}
              plant={pl}
              palette={ctx.palette}
              showWord={ctx.showWord}
              watered={ctx.watered.has(pl.lexeme_id)}
              reduceMotion={ctx.reduceMotion}
              label={plantLabel(t, pl, now)}
              onOpen={open}
            />
          ))}
        </View>
      ) : (
        <View style={{ gap: 2 }}>
          {shown.map((pl) => (
            <PlantRow key={pl.lexeme_id} plant={pl} palette={ctx.palette} label={plantLabel(t, pl, now)} status={plantStatus(t, pl, now)} onOpen={open} />
          ))}
        </View>
      )}
    </View>
  );
});

// ---------------------------------------------------------------- pages of beds
/**
 * Beds arrive ten units per page (GET /v1/garden/beds). Each page is its own query, and the next
 * page is fetched only when asked for, so a big garden never loads all at once.
 */
export function BedPages({ cursor, ctx }: { cursor: number; ctx: BedView }) {
  const { t } = useTranslation();
  const beds = useGardenBeds(cursor);
  const [more, setMore] = useState(false);
  if (!beds.data) {
    if (beds.isError) {
      return (
        <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
          <Txt variant="body-s" color="ink-2">
            {t('garden.loadFailed')}
          </Txt>
          <Button variant="secondary" size="sm" icon="refresh" onPress={() => void beds.refetch()}>
            {t('common.tryAgain')}
          </Button>
        </View>
      );
    }
    return (
      <Txt variant="body-s" color="ink-3" accessibilityLiveRegion="polite">
        {t('common.loading')}
      </Txt>
    );
  }
  const next = beds.data.next_cursor === null ? null : Number(beds.data.next_cursor);
  return (
    <>
      {beds.data.beds.map((bed) => (
        <GardenBedCard key={bed.unit_id} unitId={bed.unit_id} title={bed.title} plants={bed.plants} ctx={ctx} />
      ))}
      {next !== null && Number.isFinite(next) ? (
        more ? (
          <BedPages cursor={next} ctx={ctx} />
        ) : (
          <Button variant="secondary" block icon="chevron-down" onPress={() => setMore(true)} testID="more-beds">
            {t('garden.moreBeds')}
          </Button>
        )
      ) : null}
    </>
  );
}
