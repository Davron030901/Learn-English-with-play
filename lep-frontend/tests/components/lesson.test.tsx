import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';

import { DEFAULT_PROFILE } from '@/a11y/profile';
import type { Course, Unit } from '@/content/model';
import { ContentRepository } from '@/content/repository';
import type { Item } from '@/content/schemas';
import { LessonRunner } from '@/features/lesson/LessonRunner';
import { getOutbox } from '@/outbox';
import { composeNodeSession, type ComposedSession } from '@/runner/compose';
import { EMPTY_LEARNER, useLearner } from '@/state/learner';

import { fsContentSource } from '../support/fsSource';
import { answer } from './drive';
import { renderUI } from './render';

/**
 * The lesson runner end to end on real content (brief §6): present before test, every answer
 * stored in the outbox before anything else, feedback with the dispute link, a recovery item
 * instead of closing on a failure (the server's own when it sent one), CLOSE with stopping as the
 * primary action, and leaving at any time without losing anything.
 */

const repo = new ContentRepository(fsContentSource);
let unit: Unit;
let course: Course;
let words: ReadonlySet<string>;
let n = 0;
let learnerId = '';

beforeAll(async () => {
  [unit, course, words] = await Promise.all([repo.loadUnit('S01U01'), repo.loadCourse(), repo.loadWords()]);
});

beforeEach(async () => {
  await AsyncStorage.clear();
  n += 1;
  learnerId = `learner-${n}`;
  useLearner.setState({ learnerId, data: { ...EMPTY_LEARNER, profile: { l1: 'uz', spellingVariant: 'us' } }, loaded: true });
});

function compose(nodeId: string, tier: 1 | 2 | 3): ComposedSession {
  return composeNodeSession(unit, nodeId, tier, { profile: DEFAULT_PROFILE, completed: new Map(), seed: 3 });
}

async function show(session: ComposedSession) {
  const onLeave = jest.fn();
  const onNext = jest.fn();
  await renderUI(<LessonRunner session={session} units={new Map([[unit.id, unit]])} words={words} course={course} onLeave={onLeave} onNext={onNext} />);
  return { onLeave, onNext };
}

/** Drives the session to CLOSE, answering each item as `decide` says. Returns the items answered. */
async function drive(session: ComposedSession, decide: (item: Item, i: number) => 'right' | 'wrong' = () => 'right'): Promise<Item[]> {
  const items = session.steps.flatMap((s) => (s.kind === 'item' ? [s.item] : []));
  const answered: Item[] = [];
  for (let guard = 0; guard < 300; guard += 1) {
    if (screen.queryByTestId('close')) return answered;
    if (screen.queryByTestId('feedback-continue')) {
      await fireEvent.press(screen.getByTestId('feedback-continue'));
      continue;
    }
    if (screen.queryByTestId('got-it')) {
      // NEW INPUT is presentation only: no exercise is on screen with it.
      expect(screen.queryAllByTestId(/^exercise-/)).toHaveLength(0);
      await fireEvent.press(screen.getByTestId('got-it'));
      continue;
    }
    const shown = screen.queryAllByTestId(/^exercise-/)[0];
    if (!shown) throw new Error('nothing to do on screen');
    const type = String(shown.props.testID).replace('exercise-', '');
    // A recovery item repeats one already answered; otherwise the build order is kept.
    const next = items[answered.length];
    const item = next && next.type_id === type ? next : answered.find((a) => a.type_id === type);
    if (!item) throw new Error(`unexpected ${type}`);
    const handled = await answer(item, decide(item, answered.length) === 'wrong');
    if (!handled) throw new Error(`no driver for ${type}`);
    answered.push(item);
  }
  throw new Error('the session never reached CLOSE');
}

test('a whole node-tier: present first, every answer stored, then CLOSE marks it finished', async () => {
  const session = compose('S01U01N2', 1);
  const { onLeave } = await show(session);
  expect(screen.getByTestId('present-grammar')).toBeTruthy();
  const answered = await drive(session);

  expect(screen.getByTestId('close-practised').props.children).toBe(`You practised ${answered.length} exercises.`);
  // Stopping is the primary action and comes first.
  const stop = screen.getByTestId('close-stop');
  const next = screen.getByTestId('close-next');
  expect(stop).toBeTruthy();
  expect(next).toBeTruthy();

  const rows = await getOutbox(learnerId).list();
  expect(rows).toHaveLength(answered.length);
  expect(rows.every((r) => r.kind === 'review' && r.status === 'pending')).toBe(true);
  expect(rows.map((r) => (r.kind === 'review' ? r.payload.item_id : ''))).toEqual(answered.map((i) => i.id));
  for (const r of rows) {
    if (r.kind !== 'review') continue;
    expect(r.payload.content_version).toMatch(/^sha256:/);
    expect(r.payload.rt_ms).toBeGreaterThanOrEqual(250);
    expect(['correct', 'ungraded']).toContain(r.payload.local_verdict);
  }

  await fireEvent.press(stop);
  expect(onLeave).toHaveBeenCalledTimes(1);
  expect(useLearner.getState().data.completed.S01U01N2?.[1]).toBeTruthy();
});

test('a wrong last answer brings one recovery item before CLOSE, and the dispute is stored', async () => {
  const session = compose('S01U01N2', 3);
  const items = session.steps.filter((s) => s.kind === 'item');
  await show(session);
  // Answer everything right except the last item before close.
  let disputed = false;
  const answered = await (async () => {
    const out: Item[] = [];
    const queue = items.map((s) => (s.kind === 'item' ? s.item : null)).filter((x): x is Item => !!x);
    for (let guard = 0; guard < 300; guard += 1) {
      if (screen.queryByTestId('close')) return out;
      if (screen.queryByTestId('feedback-continue')) {
        if (!disputed && screen.queryByTestId('dispute')) {
          await fireEvent.press(screen.getByTestId('dispute'));
          disputed = true;
        }
        await fireEvent.press(screen.getByTestId('feedback-continue'));
        continue;
      }
      if (screen.queryByTestId('got-it')) {
        await fireEvent.press(screen.getByTestId('got-it'));
        continue;
      }
      const shown = screen.queryAllByTestId(/^exercise-/)[0];
      if (!shown) throw new Error('nothing on screen');
      const type = String(shown.props.testID).replace('exercise-', '');
      const item = out.length < queue.length ? queue[out.length] : out.find((a) => a.type_id === type);
      if (!item) throw new Error('no item');
      const isLast = out.length === queue.length - 1;
      await answer(item, isLast);
      out.push(item);
    }
    throw new Error('never closed');
  })();
  expect(answered.length).toBe(items.length + 1); // the recovery item
  const rows = await getOutbox(learnerId).list();
  expect(rows.filter((r) => r.kind === 'dispute')).toHaveLength(1);
  const verdicts = rows.flatMap((r) => (r.kind === 'review' ? [r.payload.local_verdict] : []));
  expect(verdicts.at(-2)).toBe('incorrect');
  expect(verdicts.at(-1)).not.toBe('incorrect');
});

test("the server's near-certain item is the recovery item when it sent one", async () => {
  const session = compose('S01U01N2', 3);
  const queue = session.steps.flatMap((s) => (s.kind === 'item' ? [s.item] : []));
  // as POST /v1/sessions sends it: an easy item from elsewhere, not in the plan
  const sure = unit.nodes
    .flatMap((node) => node.tiers[1] ?? [])
    .find((it) => it.type_id === 'mcq_word_from_definition' && !queue.some((q) => q.id === it.id));
  if (!sure) throw new Error('no recovery candidate');
  await show({ ...session, recovery: [sure] });
  const answered: Item[] = [];
  for (let guard = 0; guard < 300 && !screen.queryByTestId('close'); guard += 1) {
    if (screen.queryByTestId('feedback-continue')) {
      await fireEvent.press(screen.getByTestId('feedback-continue'));
      continue;
    }
    if (screen.queryByTestId('got-it')) {
      await fireEvent.press(screen.getByTestId('got-it'));
      continue;
    }
    const item = answered.length < queue.length ? queue[answered.length] : sure;
    if (!item) throw new Error('no item');
    expect(screen.queryAllByTestId(/^exercise-/)[0]?.props.testID).toBe(`exercise-${item.type_id}`);
    // everything right except the last item of the plan
    await answer(item, answered.length === queue.length - 1);
    answered.push(item);
  }
  expect(screen.getByTestId('close')).toBeTruthy();
  expect(answered.map((i) => i.id)).toEqual([...queue.map((i) => i.id), sure.id]);
  const rows = await getOutbox(learnerId).list();
  const verdicts = rows.flatMap((r) => (r.kind === 'review' ? [[r.payload.item_id, r.payload.local_verdict]] : []));
  expect(verdicts.at(-1)).toEqual([sure.id, 'correct']);
});

test('leaving mid-lesson asks once, keeps the answers and does not mark the node finished', async () => {
  const session = compose('S01U01N2', 2);
  const { onLeave } = await show(session);
  const first = session.steps.find((s) => s.kind === 'item');
  if (first?.kind !== 'item') throw new Error('no item');
  await answer(first.item);
  await fireEvent.press(screen.getByTestId('feedback-continue'));
  await fireEvent.press(screen.getByTestId('lesson-close'));
  expect(screen.getByTestId('leave-dialog')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('leave-yes'));
  expect(onLeave).toHaveBeenCalledTimes(1);
  expect(useLearner.getState().data.completed.S01U01N2).toBeUndefined();
  expect(await getOutbox(learnerId).size()).toBe(1);
});

test('the feedback sheet: the right form, why, and "I think my answer was right" — never a celebration', async () => {
  const session = compose('S01U01N2', 2);
  await show(session);
  const first = session.steps.find((s) => s.kind === 'item');
  if (first?.kind !== 'item') throw new Error('no item');
  await answer(first.item, true);
  expect(screen.getByTestId('feedback')).toBeTruthy();
  expect(screen.getByText('Correct answer')).toBeTruthy();
  expect(screen.getByTestId('dispute')).toBeTruthy();
  expect(screen.queryByText(/xp|streak|gem|🎉|amazing|perfect/i)).toBeNull();
});
