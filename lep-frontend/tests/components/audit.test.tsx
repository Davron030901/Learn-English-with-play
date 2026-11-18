import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import type { RetentionAuditOut } from '@/api/types';
import type { Course, Unit } from '@/content/model';
import { content } from '@/content/queries';
import { ContentRepository } from '@/content/repository';
import type { Item } from '@/content/schemas';
import { RetentionCheck } from '@/features/assessment/RetentionCheck';
import { itemsById } from '@/features/assessment/useItems';
import { getOutbox } from '@/outbox';
import { EMPTY_LEARNER, useLearner } from '@/state/learner';

import { fsContentSource } from '../support/fsSource';
import { answer } from './drive';
import { renderUI } from './render';

// The check is marked from what the server received: the test stands in for a reachable server.
jest.mock('@/features/assessment/flush', () => ({ flushOutbox: jest.fn(() => Promise.resolve(true)) }));

/**
 * The monthly memory check (docs/08 §9): well-known items answered cold, with feedback, every
 * answer under the check's id; the result compares memory with the prediction and says plainly
 * when reviews will come more often. A refusal (too soon, expired) is said, never hidden.
 */

const repo = new ContentRepository(fsContentSource);
let course: Course;
let words: ReadonlySet<string>;
let unit: Unit;
let n = 0;

beforeAll(async () => {
  [course, words, unit] = await Promise.all([repo.loadCourse(), repo.loadWords(), repo.loadUnit('S01U01')]);
});

beforeEach(async () => {
  await AsyncStorage.clear();
  n += 1;
  useLearner.setState({ learnerId: `audit-learner-${n}`, data: { ...EMPTY_LEARNER, profile: { l1: 'uz', spellingVariant: 'us' } }, loaded: true });
  jest.spyOn(content, 'loadUnit').mockImplementation((id: string) => repo.loadUnit(id));
});

afterEach(() => jest.restoreAllMocks());

const ok = <T,>(data: T, status = 200) => ({ data, error: undefined, response: { ok: true, status, headers: new Headers() } as Response });
const refused = (reason: string) => ({
  data: undefined,
  error: { type: 'assessment_conflict', status: 409, reason },
  response: { ok: false, status: 409, headers: new Headers() } as Response,
});

function choiceItems(count: number): Item[] {
  return [...itemsById(unit).values()].filter((it) => it.type_id === 'mcq_word_from_definition').slice(0, count);
}

test('a check: answered with feedback under its id, then memory against the prediction', async () => {
  const items = choiceItems(3);
  const started: RetentionAuditOut = { id: '0193d000-0000-7000-8000-0000000000a1', item_ids: items.map((i) => i.id), predicted: 0.9, actual: null, raised_retention: null };
  const post = jest.spyOn(api, 'POST').mockImplementation((async (path: string) => {
    if (path === '/v1/assessment/audit') return ok(started, 201);
    if (path === '/v1/assessment/audit/{audit_id}/complete') return ok({ ...started, actual: 0.67, raised_retention: 0.94 });
    throw new Error(`unexpected ${path}`);
  }) as never);
  await renderUI(<RetentionCheck course={course} words={words} onDone={jest.fn()} />);
  expect(screen.getByTestId('audit-intro')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('audit-start'));
  await waitFor(() => expect(screen.getByTestId('assessment-audit')).toBeTruthy());
  for (let i = 0; i < items.length; i++) {
    expect(await answer(items[i] as Item, i === 0)).toBe(true);
    await fireEvent.press(screen.getByTestId('feedback-continue'));
  }
  await waitFor(() => expect(screen.getByTestId('audit-result')).toBeTruthy());
  expect(post).toHaveBeenCalledWith('/v1/assessment/audit/{audit_id}/complete', { params: { path: { audit_id: started.id } } });
  const stored = (await getOutbox(useLearner.getState().learnerId as string).list()).filter((r) => r.kind === 'review');
  expect(stored).toHaveLength(3);
  for (const r of stored) expect((r.payload as { session_id: string }).session_id).toBe(started.id);
  expect(screen.getByTestId('audit-compare').props.children).toBe("We predicted you'd remember about 90% — you remembered 67%.");
  expect(screen.getByTestId('audit-raised')).toBeTruthy();
});

test('too soon after the last check: the refusal says when the check runs', async () => {
  jest.spyOn(api, 'POST').mockResolvedValue(refused('too_soon') as never);
  await renderUI(<RetentionCheck course={course} words={words} onDone={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('audit-start'));
  await waitFor(() => expect(screen.getByText('The retention check runs once a month.')).toBeTruthy());
});

test('an expired check is said as such, and a new one can be started', async () => {
  const items = choiceItems(1);
  const started: RetentionAuditOut = { id: '0193d000-0000-7000-8000-0000000000a2', item_ids: items.map((i) => i.id), predicted: 0.9, actual: null, raised_retention: null };
  let starts = 0;
  jest.spyOn(api, 'POST').mockImplementation((async (path: string) => {
    if (path === '/v1/assessment/audit') {
      starts += 1;
      return ok(started, 201);
    }
    return refused('expired');
  }) as never);
  await renderUI(<RetentionCheck course={course} words={words} onDone={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('audit-start'));
  await waitFor(() => expect(screen.getByTestId('assessment-audit')).toBeTruthy());
  expect(await answer(items[0] as Item)).toBe(true);
  await fireEvent.press(screen.getByTestId('feedback-continue'));
  await waitFor(() => expect(screen.getByTestId('audit-refused')).toBeTruthy());
  expect(screen.getByText('This check has expired. Start a new one.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('audit-again'));
  await waitFor(() => expect(starts).toBe(2));
});
