import { fireEvent, screen, within } from '@testing-library/react-native';

import type { Item } from '@/content/schemas';
import { expectedAnswer } from '@/grading/grade';

import { tilesForKey } from '../support/answers';

/**
 * Answers the item on screen the way a learner would, correctly (or, with `wrong`, with a
 * deliberately wrong choice). Returns false for a type this driver does not handle.
 */
export async function answer(item: Item, wrong = false): Promise<boolean> {
  switch (item.type_id) {
    case 'mcq_word_from_definition':
    case 'pragmatics_choose':
    case 'minimal_pair_discrimination':
    case 'grammaticality_judgement':
    case 'stress_tap':
    case 'phoneme_id':
    case 'odd_one_out':
    case 'read_scan_detail':
    case 'read_gist_mcq':
    case 'listen_gist_mcq':
    case 'listen_detail_gap': {
      const options = item.type_id === 'stress_tap' ? item.prompt.syllables : item.prompt.options;
      const index = wrong ? (item.answer.index + 1) % options.length : item.answer.index;
      await fireEvent.press(within(screen.getByTestId(`exercise-${item.type_id}`)).getAllByText(options[index] ?? '')[0]!);
      await fireEvent.press(screen.getByTestId('check'));
      return true;
    }
    case 'gap_fill_bank': {
      const word = wrong ? item.prompt.bank.find((w) => !item.answer.key.includes(w)) : item.answer.key[0];
      await fireEvent.press(within(screen.getByTestId('exercise-gap_fill_bank')).getAllByText(word ?? '')[0]!);
      await fireEvent.press(screen.getByTestId('check'));
      return true;
    }
    case 'type_from_l1':
    case 'dictation_word':
    case 'error_correct':
    case 'dictation_sentence':
    case 'spelling_bee':
    case 'gap_fill_free':
    case 'write_sentence':
      await fireEvent.changeText(screen.getByTestId('answer-input'), wrong ? 'zzzz' : (expectedAnswer(item) ?? 'My family is big.'));
      await fireEvent.press(screen.getByTestId('check'));
      return true;
    case 'word_bank_build':
    case 'sentence_reorder': {
      const order = tilesForKey(item.prompt.bank, item.answer.key[0] ?? '', item.answer.normalise.includes('case')) ?? [];
      for (const i of wrong ? [...order].reverse() : order) await fireEvent.press(screen.getByTestId(`tile-${i}`));
      await fireEvent.press(screen.getByTestId('check'));
      return true;
    }
    case 'tap_pairs':
    case 'memory_match':
    case 'word_race':
      for (const [l, [left]] of item.prompt.pairs.entries()) {
        const r = item.prompt.pairs.findIndex(([, g]) => item.answer.mapping[left] === g);
        await fireEvent.press(screen.getByTestId(`left-${l}`));
        await fireEvent.press(screen.getByTestId(`right-${r}`));
      }
      return true;
    case 'repeat_after':
    case 'read_aloud':
    case 'speak_prompt':
    case 'speak_roleplay':
    case 'speak_retell':
      await fireEvent.press(screen.getByTestId('type-instead'));
      await fireEvent.changeText(screen.getByTestId('speak-typed'), item.answer.key[0] ?? 'Hello, my name is Aziz.');
      await fireEvent.press(screen.getByTestId('check'));
      return true;
    case 'listen_order_events':
    case 'sort_bins':
      return false;
  }
}
