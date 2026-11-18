import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { Item, TypeId } from '@/content/schemas';
import { Txt } from '@/design';

import { BankExercise } from './families/Bank';
import { BinsExercise } from './families/Bins';
import { ChoiceExercise } from './families/Choice';
import { OrderExercise } from './families/Order';
import { PairsExercise } from './families/Pairs';
import { SpeakExercise } from './families/Speak';
import { TextExercise } from './families/Text';
import type { ExerciseProps } from './types';

function assertNever(x: never): never {
  throw new Error(`no renderer for ${String(x)}`);
}

/**
 * The registry (brief §5): type_id → family renderer. A total switch with no default, so adding a
 * type (mcq_image and listen_choose_image when images exist — DECISIONS F4) fails to compile
 * until it has a renderer; nothing in the app assumes there are exactly 31.
 */
function render(props: ExerciseProps): React.ReactElement {
  const { item } = props;
  switch (item.type_id) {
    case 'mcq_word_from_definition':
    case 'pragmatics_choose':
    case 'minimal_pair_discrimination':
    case 'grammaticality_judgement':
    case 'gap_fill_bank':
    case 'stress_tap':
    case 'phoneme_id':
    case 'odd_one_out':
    case 'read_scan_detail':
    case 'read_gist_mcq':
    case 'listen_gist_mcq':
    case 'listen_detail_gap':
      return <ChoiceExercise {...props} item={item} />;
    case 'type_from_l1':
    case 'dictation_word':
    case 'error_correct':
    case 'dictation_sentence':
    case 'spelling_bee':
    case 'gap_fill_free':
    case 'write_sentence':
      return <TextExercise {...props} item={item} />;
    case 'word_bank_build':
    case 'sentence_reorder':
      return <BankExercise {...props} item={item} />;
    case 'listen_order_events':
      return <OrderExercise {...props} item={item} />;
    case 'tap_pairs':
    case 'memory_match':
    case 'word_race':
      return <PairsExercise {...props} item={item} />;
    case 'sort_bins':
      return <BinsExercise {...props} item={item} />;
    case 'repeat_after':
    case 'speak_prompt':
    case 'read_aloud':
    case 'speak_roleplay':
    case 'speak_retell':
      return <SpeakExercise {...props} item={item} />;
    default:
      return assertNever(item);
  }
}

/** The instruction, in the interface language (brief §5.3: a key, not a string). */
export function instructionText(
  instructions: Readonly<Record<string, readonly [string, string]>>,
  key: string,
  language: string,
): string {
  const pair = instructions[key];
  if (!pair) return '';
  return language === 'uz' ? pair[1] : pair[0];
}

export const ExerciseView = memo(function ExerciseView(
  props: ExerciseProps & { instruction: string },
) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 18 }} testID={`exercise-${props.item.type_id}`}>
      <Txt variant="title-m" accessibilityRole="header" testID="instruction">
        {props.instruction || t('lesson.check')}
      </Txt>
      {render(props)}
    </View>
  );
});

export type { Item, TypeId };
