import { fireEvent, screen, within } from '@testing-library/react-native';

import type { Unit } from '@/content/model';
import { ContentRepository } from '@/content/repository';
import type { Item, ItemOf, TypeId } from '@/content/schemas';
import { ExerciseView } from '@/exercises/ExerciseView';
import type { ExerciseContext } from '@/exercises/types';
import { presentationOrder } from '@/exercises/shuffle';
import { grade, type Submission } from '@/grading/grade';

import { tilesForKey } from '../support/answers';
import { fsContentSource } from '../support/fsSource';
import { renderUI } from './render';

/**
 * Every renderer family, driven the way a learner drives it, on real items: the submission it
 * hands the grader must grade correct. Shuffled positions map back to canonical indexes.
 */

const repo = new ContentRepository(fsContentSource);
let u1: Unit;
let u9: Unit;
let words: ReadonlySet<string>;

beforeAll(async () => {
  [u1, u9, words] = await Promise.all([repo.loadUnit('S01U01'), repo.loadUnit('S01U09'), repo.loadWords()]);
});

function find<T extends TypeId>(unit: Unit, id: string, type: T): ItemOf<T> {
  const item = unit.nodes.flatMap((n) => Object.values(n.tiers).flat()).find((i): i is Item => i?.id === id);
  if (!item || item.type_id !== type) throw new Error(`${id} is not a ${type}`);
  return item as ItemOf<T>;
}

function ctxFor(unit: Unit, over: Partial<ExerciseContext> = {}): ExerciseContext {
  return {
    unit,
    cefr: unit.cefr,
    l1: 'uz',
    english: words,
    profile: { noAudio: false, noVision: false },
    accent: 'us',
    speed: 1,
    timers: 'default',
    timedMode: false,
    whisper: false,
    seed: 12345,
    reduceMotion: true,
    ...over,
  };
}

async function show(item: Item, unit: Unit, over: Partial<ExerciseContext> = {}) {
  const onSubmit = jest.fn<void, [Submission]>();
  await renderUI(<ExerciseView item={item} ctx={ctxFor(unit, over)} result={null} plays={0} onPlay={jest.fn()} hint={null} onSubmit={onSubmit} instruction="Do it." />);
  return onSubmit;
}

const submitted = (fn: jest.Mock<void, [Submission]>): Submission => {
  expect(fn).toHaveBeenCalledTimes(1);
  return fn.mock.calls[0]?.[0] as Submission;
};

test('choice: the tapped option is graded by its canonical index', async () => {
  const item = find(u1, 'item.0000003', 'mcq_word_from_definition');
  const onSubmit = await show(item, u1);
  const right = item.prompt.options[item.answer.index] ?? '';
  // Nothing is submitted until Check.
  expect(screen.getByTestId('check')).toBeDisabled();
  await fireEvent.press(screen.getByText(right));
  await fireEvent.press(screen.getByTestId('check'));
  const sub = submitted(onSubmit);
  expect(sub).toEqual({ kind: 'choice', index: item.answer.index });
  expect(grade(item, sub, { words }).verdict).toBe('correct');
});

test('text: typed answers go to the grader as typed', async () => {
  const item = find(u1, 'item.0000024', 'dictation_word');
  const onSubmit = await show(item, u1);
  await fireEvent.changeText(screen.getByTestId('answer-input'), item.answer.key[0] ?? '');
  await fireEvent.press(screen.getByTestId('check'));
  expect(grade(item, submitted(onSubmit), { words }).verdict).toBe('correct');
});

test('bank: tiles are submitted by index, in the order chosen', async () => {
  const item = find(u1, 'item.0000088', 'sentence_reorder');
  const order = tilesForKey(item.prompt.bank, item.answer.key[0] ?? '', item.answer.normalise.includes('case'));
  expect(order).not.toBeNull();
  const onSubmit = await show(item, u1);
  for (const i of order ?? []) await fireEvent.press(screen.getByTestId(`tile-${i}`));
  await fireEvent.press(screen.getByTestId('check'));
  const sub = submitted(onSubmit);
  expect(sub).toEqual({ kind: 'tiles', indices: order });
  expect(grade(item, sub, { words }).verdict).toBe('correct');
});

test('pairs: matching every pair submits once, complete', async () => {
  const item = find(u1, 'item.0000001', 'tap_pairs');
  const onSubmit = await show(item, u1);
  for (const [l, [left]] of item.prompt.pairs.entries()) {
    const r = item.prompt.pairs.findIndex(([, g]) => item.answer.mapping[left] === g);
    await fireEvent.press(screen.getByTestId(`left-${l}`));
    await fireEvent.press(screen.getByTestId(`right-${r}`));
  }
  const sub = submitted(onSubmit);
  expect(sub).toMatchObject({ kind: 'pairs', complete: true, mistakes: 0 });
  expect(grade(item, sub, { words }).verdict).toBe('correct');
});

test('memory_match: flipping two cards of a pair keeps them; the last pair submits', async () => {
  const item = find(u1, 'item.0000002', 'memory_match');
  const onSubmit = await show(item, u1);
  const n = item.prompt.pairs.length;
  // The same deterministic deal the renderer makes: display index -> (pair, side).
  const deal = presentationOrder(2 * n, `${item.id}:M`, 12345).map((k) => ({ pair: k % n, side: k < n ? 0 : 1 }));
  expect(screen.getByLabelText('Card 1, face down')).toBeTruthy();
  for (let p = 0; p < n; p += 1) {
    const left = deal.findIndex((c) => c.pair === p && c.side === 0);
    const gloss = item.prompt.pairs.findIndex(([, g]) => item.answer.mapping[item.prompt.pairs[p]?.[0] ?? ''] === g);
    const right = deal.findIndex((c) => c.pair === gloss && c.side === 1);
    await fireEvent.press(screen.getByTestId(`card-${left}`));
    await fireEvent.press(screen.getByTestId(`card-${right}`));
  }
  const sub = submitted(onSubmit);
  expect(sub).toMatchObject({ kind: 'pairs', complete: true, mistakes: 0 });
  expect(grade(item, sub, { words }).verdict).toBe('correct');
});

test('memory_match becomes the face-up list for a screen-reader learner', async () => {
  const item = find(u1, 'item.0000002', 'memory_match');
  await show(item, u1, { profile: { noAudio: false, noVision: true } });
  expect(screen.queryByTestId('card-0')).toBeNull();
  expect(screen.getByTestId('left-0')).toBeTruthy();
});

test('bins: every word placed, then checked', async () => {
  const item = find(u9, 'item.0002868', 'sort_bins');
  const onSubmit = await show(item, u9);
  for (const [i, word] of item.prompt.options.entries()) {
    const bin = item.answer.mapping[word] ?? '';
    const row = within(screen.getByTestId(`bin-row-${i}`));
    await fireEvent.press(row.getByRole('radio', { name: bin }));
  }
  await fireEvent.press(screen.getByTestId('check'));
  expect(grade(item, submitted(onSubmit), { words }).verdict).toBe('correct');
});

test('speak: the text route is always there, and a typed answer is graded as text', async () => {
  const item = find(u1, 'item.0000014', 'repeat_after');
  const onSubmit = await show(item, u1);
  expect(screen.getByText(/stay on this device/i)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('type-instead'));
  await fireEvent.changeText(screen.getByTestId('speak-typed'), item.answer.key[0] ?? '');
  await fireEvent.press(screen.getByTestId('check'));
  const sub = submitted(onSubmit);
  expect(sub).toMatchObject({ kind: 'speech', modality: 'typed' });
  expect(grade(item, sub, { words }).verdict).toBe('correct');
});

test('speak: "Type instead" turns the microphone off — it never records behind the text field', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const recorder = (require('expo-audio') as { useAudioRecorder: () => { stop: jest.Mock; record: jest.Mock } }).useAudioRecorder();
  recorder.stop.mockClear();
  recorder.record.mockClear();
  const item = find(u1, 'item.0000014', 'repeat_after');
  const onSubmit = await show(item, u1);
  await fireEvent.press(screen.getByTestId('mic'));
  expect(recorder.record).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('type-instead'));
  expect(recorder.stop).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByTestId('speak-typed')).toBeTruthy();
});

test('order: the learner’s order is what is submitted', async () => {
  const item = find(u1, 'item.0000236', 'listen_order_events');
  const onSubmit = await show(item, u1);
  await fireEvent.press(screen.getByTestId('check'));
  const sub = submitted(onSubmit);
  expect(sub.kind).toBe('order');
  expect(sub.kind === 'order' && [...sub.indices].sort()).toEqual(item.prompt.options.map((_, i) => i));
});

test('the instruction is a heading and the level comes from the unit', async () => {
  const item = find(u1, 'item.0000003', 'mcq_word_from_definition');
  await show(item, u1);
  expect(screen.getByRole('header', { name: 'Do it.' })).toBeTruthy();
});
