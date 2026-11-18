import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { playsCap } from '@/audio/policy';
import { itemAudio } from '@/audio/resolve';
import { l1Prompt } from '@/content/l1';
import type { ItemOf } from '@/content/schemas';
import { Notice, TextField, Txt } from '@/design';
import { isBlank } from '@/grading/grade';

import { AudioControl, CheckButton, GapText, L1Prompt } from '../parts';
import type { ExerciseProps } from '../types';

export type TextItem = ItemOf<
  | 'type_from_l1'
  | 'dictation_word'
  | 'error_correct'
  | 'dictation_sentence'
  | 'spelling_bee'
  | 'gap_fill_free'
  | 'write_sentence'
>;

/**
 * Family 2 — Text: free typing. Autocorrect and spell-check are off: a keyboard that fixes the
 * spelling would answer a spelling exercise for the learner.
 */
export function TextExercise({
  item,
  ctx,
  result,
  plays,
  onPlay,
  onSubmit,
}: ExerciseProps<TextItem>) {
  const { t } = useTranslation();
  const [text, setText] = useState(item.type_id === 'error_correct' ? item.prompt.text : '');
  const locked = result !== null;
  const cap = playsCap(item, ctx.cefr);
  const audio = itemAudio(item);
  const multiline =
    item.type_id === 'write_sentence' ||
    item.type_id === 'dictation_sentence' ||
    item.type_id === 'error_correct';

  let stem: React.ReactNode = null;
  switch (item.type_id) {
    case 'type_from_l1':
      stem = <L1Prompt text={l1Prompt(item, ctx.l1, ctx.unit.lexemes)} l1={ctx.l1} />;
      break;
    case 'dictation_word':
    case 'dictation_sentence':
    case 'spelling_bee':
      stem = ctx.profile.noAudio ? (
        // No-audio route (brief §12): the stem is shown and the task becomes copying it.
        <View style={{ gap: 8 }}>
          <Notice icon="eye">{t('settings.noAudioHelp')}</Notice>
          <Txt variant="learn-l" lang="en">
            {item.say ?? item.answer.key[0] ?? ''}
          </Txt>
        </View>
      ) : audio ? (
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
    case 'error_correct':
      stem = (
        <Txt variant="learn-l" lang="en" testID="stem">
          {item.prompt.text}
        </Txt>
      );
      break;
    case 'gap_fill_free':
      stem = <GapText text={item.prompt.text} fill={text.trim() || null} />;
      break;
    case 'write_sentence':
      stem = (
        <Txt variant="learn-l" lang="en" testID="stem">
          {item.prompt.text}
        </Txt>
      );
      break;
  }

  return (
    <View style={{ gap: 20 }}>
      {stem}
      <TextField
        label={item.type_id === 'type_from_l1' ? t('lesson.typeInEnglish') : t('lesson.yourAnswer')}
        value={text}
        onChangeText={setText}
        editable={!locked}
        learn
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        textContentType="none"
        returnKeyType={multiline ? 'default' : 'done'}
        onSubmitEditing={() => {
          if (!multiline && !isBlank(text) && !locked) onSubmit({ kind: 'text', text });
        }}
        testID="answer-input"
      />
      {locked ? null : (
        <CheckButton disabled={isBlank(text)} onPress={() => onSubmit({ kind: 'text', text })} />
      )}
    </View>
  );
}
