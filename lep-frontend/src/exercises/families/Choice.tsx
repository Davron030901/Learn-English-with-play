import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';

import { playsCap, transcriptMode, transcriptVisible } from '@/audio/policy';
import { itemAudio, optionAudio } from '@/audio/resolve';
import { play, useAnySyntheticFallback, usePlayingKey } from '@/audio/speech';
import { l1Prompt } from '@/content/l1';
import { stressDescription } from '@/content/notation';
import type { ItemOf } from '@/content/schemas';
import { AudioButton, ChoiceCard, Txt, WordTile, type ChoiceState, TextLink } from '@/design';
import { gradeContextFor } from '@/features/lesson/record';
import { grade } from '@/grading/grade';

import {
  AudioControl,
  CheckButton,
  GapText,
  L1Prompt,
  StoryScript,
  SyntheticVoiceChip,
} from '../parts';
import { presentationOrder } from '../shuffle';
import type { ExerciseProps } from '../types';

export type ChoiceItem = ItemOf<
  | 'mcq_word_from_definition'
  | 'pragmatics_choose'
  | 'minimal_pair_discrimination'
  | 'grammaticality_judgement'
  | 'gap_fill_bank'
  | 'stress_tap'
  | 'phoneme_id'
  | 'odd_one_out'
  | 'read_scan_detail'
  | 'read_gist_mcq'
  | 'listen_gist_mcq'
  | 'listen_detail_gap'
>;

function optionsOf(item: ChoiceItem): string[] {
  if (item.type_id === 'gap_fill_bank') return item.prompt.bank;
  if (item.type_id === 'stress_tap') return item.prompt.syllables;
  return item.prompt.options;
}

/** Family 1 — Choice: single selection over 1–8 options (never assume four). */
export function ChoiceExercise({
  item,
  ctx,
  result,
  plays,
  onPlay,
  onSubmit,
}: ExerciseProps<ChoiceItem>) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const options = optionsOf(item);
  const order = useMemo(
    () =>
      item.type_id === 'stress_tap'
        ? options.map((_, i) => i)
        : presentationOrder(options.length, item.id, ctx.seed),
    [item.id, item.type_id, options, ctx.seed],
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [transcriptAsked, setTranscriptAsked] = useState(false);
  const playingKey = usePlayingKey();
  const optionKeys = useMemo(
    () => (item.type_id === 'phoneme_id' ? options.map((_, i) => `${item.id}#${i}`) : []),
    [item.type_id, item.id, options],
  );
  const optionFellBack = useAnySyntheticFallback(optionKeys);

  // The highlight comes from the grader itself, so the card can never contradict the verdict
  // (a bank can hold two acceptable words, and accepted forms include US/UK alternatives).
  const correctSet = useMemo(() => {
    if (item.type_id === 'gap_fill_bank') {
      const gctx = gradeContextFor(item, ctx.unit, ctx.english);
      return new Set(
        item.prompt.bank.flatMap((w, i) =>
          grade(item, { kind: 'text', text: w }, gctx).verdict === 'correct' ? [i] : [],
        ),
      );
    }
    return new Set([item.answer.index]);
  }, [item, ctx.unit, ctx.english]);

  const locked = result !== null;
  const stateOf = (shown: number): ChoiceState => {
    const canonical = order[shown] as number;
    if (!locked) return selected === shown ? 'selected' : 'idle';
    if (selected === shown) return result.verdict === 'correct' ? 'correct' : 'wrong';
    if (correctSet.has(canonical)) return 'correct';
    return 'dim';
  };

  const submit = () => {
    if (selected === null) return;
    const canonical = order[selected] as number;
    if (item.type_id === 'gap_fill_bank')
      onSubmit({ kind: 'text', text: item.prompt.bank[canonical] ?? '' });
    else onSubmit({ kind: 'choice', index: canonical });
  };

  const cap = playsCap(item, ctx.cefr);
  const audio = itemAudio(item);
  const tMode = transcriptMode(item, ctx.cefr, ctx.profile.noAudio);
  const showTranscript = transcriptVisible(tMode, plays, transcriptAsked, locked);

  // ------------------------------------------------------------ stem
  let stem: React.ReactNode = null;
  switch (item.type_id) {
    case 'mcq_word_from_definition':
      stem = <L1Prompt text={l1Prompt(item, ctx.l1, ctx.unit.lexemes)} l1={ctx.l1} />;
      break;
    case 'pragmatics_choose':
    case 'grammaticality_judgement':
      stem = (
        <Txt variant="learn-l" lang="en" testID="stem">
          {item.prompt.text}
        </Txt>
      );
      break;
    case 'gap_fill_bank':
      stem = (
        <GapText
          text={item.prompt.text}
          fill={selected !== null ? item.prompt.bank[order[selected] as number] : null}
        />
      );
      break;
    case 'minimal_pair_discrimination':
      stem = audio ? (
        <AudioControl
          source={audio}
          audioKey={item.id}
          cefr={ctx.cefr}
          accent={ctx.accent}
          plays={plays}
          cap={cap}
          onPlay={onPlay}
        />
      ) : null;
      break;
    case 'stress_tap':
      stem = (
        <View style={{ alignItems: 'center', gap: 12 }}>
          <Txt variant="learn-xl" lang="en" align="center">
            {item.prompt.text}
          </Txt>
          {audio && !ctx.profile.noAudio ? (
            <AudioControl
              source={audio}
              audioKey={item.id}
              cefr={ctx.cefr}
              accent={ctx.accent}
              plays={plays}
              cap={cap}
              onPlay={onPlay}
              size="md"
              showSlow={false}
            />
          ) : null}
        </View>
      );
      break;
    case 'phoneme_id':
      stem = (
        <Txt variant="learn-l" lang="en">
          {item.prompt.text}
        </Txt>
      );
      break;
    case 'odd_one_out':
      stem = null;
      break;
    case 'read_scan_detail':
    case 'read_gist_mcq':
      // Passage and question in one scroll region (brief §5.6: no split attention).
      stem = (
        <View style={{ gap: 12 }}>
          <StoryScript story={ctx.unit.story} />
          <Txt variant="title-m" lang="en">
            {item.prompt.text}
          </Txt>
        </View>
      );
      break;
    case 'listen_gist_mcq':
    case 'listen_detail_gap':
      stem = (
        <View style={{ gap: 12 }}>
          {audio && !ctx.profile.noAudio ? (
            <AudioControl
              source={audio}
              audioKey={item.id}
              cefr={ctx.cefr}
              accent={ctx.accent}
              plays={plays}
              cap={cap}
              onPlay={onPlay}
            />
          ) : null}
          {showTranscript ? (
            <StoryScript story={ctx.unit.story} />
          ) : tMode === 'on_demand' ||
            ((tMode === 'after_1' || tMode === 'after_2') &&
              plays >= (tMode === 'after_1' ? 1 : 2)) ? (
            <TextLink icon="eye" onPress={() => setTranscriptAsked(true)}>
              {t('lesson.showTranscript')}
            </TextLink>
          ) : null}
          <Txt variant="title-m" lang="en">
            {item.prompt.text}
          </Txt>
        </View>
      );
      break;
  }

  // ------------------------------------------------------------ options
  const n = options.length;
  // phoneme_id options carry their own play button, which needs the row layout's trailing slot.
  const grid =
    n === 4 &&
    width >= 360 &&
    item.type_id !== 'pragmatics_choose' &&
    item.type_id !== 'phoneme_id' &&
    options.every((o) => o.length <= 18);
  const labelFor = (text: string) => {
    if (item.type_id !== 'minimal_pair_discrimination') return text;
    const d = stressDescription(text);
    return d ? t('lesson.stressOn', { word: d.word, part: d.stressed }) : text;
  };

  const optionViews =
    item.type_id === 'stress_tap' ? (
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}
        accessibilityRole="radiogroup"
      >
        {order.map((canonical, shown) => {
          const s = stateOf(shown);
          return (
            <WordTile
              key={shown}
              size="lg"
              state={
                s === 'dim'
                  ? 'dim'
                  : s === 'correct'
                    ? 'correct'
                    : s === 'wrong'
                      ? 'wrong'
                      : s === 'selected'
                        ? 'selected'
                        : 'idle'
              }
              onPress={locked ? undefined : () => setSelected(shown)}
              accessibilityLabel={`${options[canonical]}, ${t('lesson.position', { n: shown + 1, total: n })}`}
              testID={`option-${shown}`}
            >
              {options[canonical] ?? ''}
            </WordTile>
          );
        })}
      </View>
    ) : (
      <View
        style={{
          flexDirection: grid ? 'row' : 'column',
          flexWrap: grid ? 'wrap' : 'nowrap',
          gap: 12,
        }}
        accessibilityRole="radiogroup"
      >
        {order.map((canonical, shown) => {
          const text = options[canonical] ?? '';
          const optionKey = `${item.id}#${canonical}`;
          return (
            <View key={shown} style={grid ? { width: '47%', flexGrow: 1 } : undefined}>
              <ChoiceCard
                index={shown + 1}
                layout={grid && n === 4 && text.length <= 10 ? 'tile' : 'row'}
                state={stateOf(shown)}
                onPress={locked ? undefined : () => setSelected(shown)}
                disabled={locked}
                accessibilityLabel={labelFor(text)}
                font={item.type_id === 'grammaticality_judgement' ? 'ui' : 'learn'}
                testID={`option-${shown}`}
                trailing={
                  item.type_id === 'phoneme_id' ? (
                    <AudioButton
                      size="sm"
                      label={`${t('lesson.play')}: ${text}`}
                      playing={playingKey === optionKey}
                      onPress={() => {
                        onPlay();
                        void play(optionKey, optionAudio(item, canonical), {
                          rate: 1,
                          accent: ctx.accent,
                        });
                      }}
                    />
                  ) : undefined
                }
              >
                {text}
              </ChoiceCard>
            </View>
          );
        })}
      </View>
    );

  return (
    <View style={{ gap: 20 }}>
      {stem}
      {optionViews}
      {item.type_id === 'phoneme_id' &&
      (optionFellBack ||
        item.prompt.options.some((_, i) => optionAudio(item, i).kind !== 'asset')) ? (
        <View style={{ alignItems: 'center' }}>
          <SyntheticVoiceChip />
        </View>
      ) : null}
      {locked ? null : <CheckButton disabled={selected === null} onPress={submit} />}
    </View>
  );
}
