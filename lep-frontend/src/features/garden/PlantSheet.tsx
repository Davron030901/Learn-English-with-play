import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Plant } from '@/api/types';
import { resolveAudio } from '@/audio/resolve';
import { play, type Accent } from '@/audio/speech';
import { CONTENT_L1 } from '@/content/l1';
import { useLexicon } from '@/content/queries';
import { AudioButton, Button, CONTENT_MAX, Chip, Txt, radius, useTheme, type Tone } from '@/design';
import { SyntheticVoiceChip } from '@/exercises/parts';
import { useLearner } from '@/state/learner';
import { usePrefs } from '@/state/prefs';

import { PlantArt, thirstOf, type PlantPalette, type PlantStage } from './PlantArt';

/** The five sides of a word (docs/08 §3), in the order they unlock. */
export const ASPECTS = ['recog', 'aural', 'recall', 'spell', 'prod'] as const;
type Aspect = (typeof ASPECTS)[number];

/** Which mastery state is weaker (the plant is only as strong as its weakest leaf). */
const WEAKNESS: Readonly<Record<string, number>> = { suspended: -1, leech: 0, unseen: 0.5, learning: 1, young: 2, retained: 3, durable: 4, retired: 5 };

export function weakestAspect(aspects: Readonly<Record<string, string>>): Aspect | null {
  let best: Aspect | null = null;
  for (const a of ASPECTS) {
    const state = aspects[a];
    if (state === undefined) continue;
    if (best === null || (WEAKNESS[state] ?? 0) < (WEAKNESS[aspects[best] as string] ?? 0)) best = a;
  }
  return best;
}

export const STAGE_TONE: Readonly<Record<PlantStage, Tone>> = {
  seed: 'orange',
  sprout: 'yellow',
  bush: 'green',
  bloom: 'pink',
  tree: 'purple',
  leech: 'purple',
  paused: 'blue',
};

const DAY_MS = 86_400_000;

/** One aspect as a leaf: filled when met, a dashed outline when not unlocked yet. */
function AspectLeaf({ aspect, state, weakest, palette }: { aspect: Aspect; state: string | undefined; weakest: boolean; palette: PlantPalette }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const met = state !== undefined;
  const name = t(`garden.aspect.${aspect}`);
  const stateText = met ? t(`garden.aspectState.${state}`, { defaultValue: state }) : t('garden.aspectLocked');
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('garden.aspectA11y', { aspect: name, state: stateText })}
      testID={`aspect-${aspect}`}
      style={{ flex: 1, minWidth: 54, alignItems: 'center', gap: 4 }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: weakest ? 2 : 0,
          borderColor: theme.c.ink,
          backgroundColor: met ? theme.c['green-soft'] : 'transparent',
        }}
      >
        <Svg width={26} height={26} viewBox="0 0 24 24">
          <Path
            d="M12 21 C5 16 5 8 12 3 C19 8 19 16 12 21 Z M12 21 L12 8"
            fill={met ? palette.leaf : 'none'}
            stroke={met ? palette.leaf2 : theme.c['line-2']}
            strokeWidth={1.6}
            strokeDasharray={met ? undefined : '2.5 2'}
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      <Txt variant="caption" weight={800} align="center" style={{ fontSize: 12, lineHeight: 15 }}>
        {name}
      </Txt>
      <Txt variant="caption" color="ink-3" align="center" style={{ fontSize: 11, lineHeight: 14 }}>
        {stateText}
      </Txt>
    </View>
  );
}

/**
 * Tapping a plant: the word, how to say it, what it means, how it is growing and when it next
 * needs water — all from the server's state for the word, never estimated here.
 */
export function PlantSheet({ plant, bedTitle, palette, onClose }: { plant: Plant | null; bedTitle: string; palette: PlantPalette; onClose: () => void }) {
  if (!plant) return null;
  // Keyed by the word, so the sheet's clock is read once each time a plant is opened.
  return <PlantSheetBody key={plant.lexeme_id} plant={plant} bedTitle={bedTitle} palette={palette} onClose={onClose} />;
}

function PlantSheetBody({ plant, bedTitle, palette, onClose }: { plant: Plant; bedTitle: string; palette: PlantPalette; onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const profile = useLearner((s) => s.data.profile);
  const speed = usePrefs((s) => s.speed);
  const noAudio = usePrefs((s) => s.noAudio);
  const lexicon = useLexicon(true);
  const [openedAt] = useState(() => Date.now());
  const l1 = profile?.l1 ?? CONTENT_L1;
  const accent: Accent = profile?.spellingVariant ?? 'us';
  const entry = useMemo(() => lexicon.data?.lookup(plant.lemma).find((x) => x.id === plant.lexeme_id), [lexicon.data, plant]);

  const thirst = thirstOf(plant);
  const weakest = weakestAspect(plant.aspects);
  const days = Math.ceil((Date.parse(plant.due_at) - openedAt) / DAY_MS);
  const when = thirst !== 'fresh' ? t('garden.needsWater') : days >= 1 ? t('garden.nextWatering', { count: days }) : t('garden.nextToday');
  const gloss = entry?.gloss[l1];

  return (
    <Modal transparent visible animationType={theme.reduceMotion ? 'none' : 'slide'} onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.c.scrim }}
        />
        <View
          accessibilityViewIsModal
          testID="plant-sheet"
          style={{
            width: '100%',
            maxWidth: CONTENT_MAX,
            maxHeight: '88%',
            alignSelf: 'center',
            backgroundColor: theme.c.surface,
            borderTopStartRadius: radius.xl,
            borderTopEndRadius: radius.xl,
            paddingBottom: Math.max(insets.bottom, 16),
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginTop: 10, backgroundColor: theme.c['line-2'] }} />
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
            <Txt variant="overline" color="ink-3">
              {bedTitle}
            </Txt>
            <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
              <View style={{ padding: 6, borderRadius: radius.lg, backgroundColor: theme.c['orange-soft'] }}>
                <PlantArt stage={plant.stage} thirst={thirst} seedKey={plant.lexeme_id} palette={palette} size={64} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Txt variant="learn-l" weight={700} lang="en" accessibilityRole="header" style={{ fontSize: 28, lineHeight: 34 }}>
                  {plant.lemma}
                </Txt>
                {entry?.ipa ? (
                  <Txt variant="ipa" color="ink-3">
                    {`/${entry.ipa}/`}
                  </Txt>
                ) : null}
                {gloss ? (
                  <Txt variant="title-s" weight={800} lang={l1}>
                    {gloss}
                  </Txt>
                ) : null}
              </View>
              {noAudio ? null : (
                <AudioButton size="sm" label={t('garden.playWord', { word: plant.lemma })} onPress={() => void play(`garden:${plant.lexeme_id}`, resolveAudio(null, plant.lemma), { rate: speed, accent })} />
              )}
            </View>
            {noAudio ? null : <SyntheticVoiceChip />}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Chip tone={STAGE_TONE[plant.stage]}>{t(`garden.stage.${plant.stage}`)}</Chip>
              <Chip tone={thirst === 'fresh' ? undefined : 'lagoon'} icon={thirst === 'fresh' ? 'calendar' : 'info'}>
                {when}
              </Chip>
            </View>

            <View style={{ gap: 10 }}>
              <Txt variant="title-s" accessibilityRole="header">
                {t('garden.aspectsTitle')}
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {ASPECTS.map((a) => (
                  <AspectLeaf key={a} aspect={a} state={plant.aspects[a]} weakest={a === weakest} palette={palette} />
                ))}
              </View>
              {weakest ? (
                <Txt variant="body-s" color="ink-2" testID="weakest">
                  {t('garden.weakest', { aspect: t(`garden.aspect.${weakest}`) })}
                </Txt>
              ) : null}
            </View>

            <Txt variant="body-m" color="ink-2">
              {thirst === 'fresh' ? t('garden.healthy') : t('garden.dueNote')}
            </Txt>
            {entry?.example ? (
              <Txt variant="learn-s" color="ink-2" lang="en" style={{ fontSize: 16, lineHeight: 23 }}>
                {entry.example}
              </Txt>
            ) : null}

            <Button variant="secondary" block onPress={onClose} testID="plant-sheet-close">
              {t('common.close')}
            </Button>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
