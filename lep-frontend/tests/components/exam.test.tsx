import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import type { ExamOut, ExamResultOut } from '@/api/types';
import type { Course, Unit } from '@/content/model';
import { content } from '@/content/queries';
import { ContentRepository } from '@/content/repository';
import type { Item } from '@/content/schemas';
import { LevelExam, examItemIds } from '@/features/assessment/LevelExam';
import { itemsById } from '@/features/assessment/useItems';
import { getOutbox } from '@/outbox';
import { EMPTY_LEARNER, useLearner } from '@/state/learner';

import { fsContentSource } from '../support/fsSource';
import { answer } from './drive';
import { renderUI } from './render';

// The exam is marked from what the server received: the test stands in for a reachable server.
jest.mock('@/features/assessment/flush', () => ({ flushOutbox: jest.fn(() => Promise.resolve(true)) }));

/**
 * The level exam (docs/12 §4): the server forms it and marks it; the device shows the items,
 * says when the exam ends and what passing takes, marks nothing while it runs, stores every
 * answer under the exam's id, and then shows each paper against the pass marks.
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
  useLearner.setState({ learnerId: `exam-learner-${n}`, data: { ...EMPTY_LEARNER, profile: { l1: 'uz', spellingVariant: 'us' } }, loaded: true });
  jest.spyOn(content, 'loadUnit').mockImplementation((id: string) => repo.loadUnit(id));
});

afterEach(() => jest.restoreAllMocks());

const ok = <T,>(data: T, status = 200) => ({ data, error: undefined, response: { ok: true, status, headers: new Headers() } as Response });

function choiceItems(count: number): Item[] {
  return [...itemsById(unit).values()].filter((it) => it.type_id === 'mcq_word_from_definition').slice(0, count);
}

test('the form is taken paper by paper, in the order of the exam', () => {
  expect(examItemIds({ papers: { use_of_english: ['c'], listening: ['a'], reading: ['b'], extra: ['d'] } })).toEqual(['a', 'b', 'c', 'd']);
});

test('an exam: the rules first, then the end time and pass marks, no marks while it runs, the papers at the end', async () => {
  const items = choiceItems(3);
  expect(items).toHaveLength(3);
  const exam: ExamOut = {
    id: '0193b000-0000-7000-8000-00000000e001',
    level: 'A1',
    papers: { reading: [items[0]?.id as string], use_of_english: [items[1]?.id as string, items[2]?.id as string, 'item.9999999'] },
    pass_overall: 0.75,
    pass_paper: 0.6,
    created_at: '2026-10-06T09:00:00Z',
    ends_at: '2026-10-06T09:55:00Z',
    reused: false,
  };
  const result: ExamResultOut = { id: exam.id, level: 'A1', scores: { reading: 1, use_of_english: 0.5 }, overall: 0.75, passed: false };
  const post = jest.spyOn(api, 'POST').mockImplementation((async (path: string) => {
    if (path === '/v1/assessment/exams') return ok(exam, 201);
    if (path === '/v1/assessment/exams/{exam_id}/complete') return ok(result);
    throw new Error(`unexpected ${path}`);
  }) as never);
  const onDone = jest.fn();
  await renderUI(<LevelExam level="A1" course={course} words={words} onDone={onDone} />);

  expect(screen.getByTestId('exam-intro')).toBeTruthy();
  expect(screen.getByText('No right or wrong is shown until the end, and there are no hints.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('exam-start'));
  await waitFor(() => expect(screen.getByTestId('exam-ready')).toBeTruthy());
  expect(post).toHaveBeenCalledWith('/v1/assessment/exams', { body: { level: 'A1' } });
  expect(screen.getByTestId('exam-pass').props.children).toBe('To pass: 75% overall, and no paper below 60%.');
  // one id is not in this build's content: said before the exam starts
  await waitFor(() => expect(screen.getByTestId('exam-missing')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('exam-begin'));
  await waitFor(() => expect(screen.getByTestId('assessment-exam')).toBeTruthy());
  for (let i = 0; i < items.length; i++) {
    expect(await answer(items[i] as Item, i === 1)).toBe(true);
    expect(screen.queryByTestId('feedback-continue')).toBeNull();
  }

  await waitFor(() => expect(screen.getByTestId('exam-not-yet')).toBeTruthy());
  expect(post).toHaveBeenCalledWith('/v1/assessment/exams/{exam_id}/complete', { params: { path: { exam_id: exam.id } } });
  const learnerId = useLearner.getState().learnerId as string;
  const stored = (await getOutbox(learnerId).list()).filter((r) => r.kind === 'review');
  expect(stored).toHaveLength(3);
  for (const r of stored) expect((r.payload as { session_id: string }).session_id).toBe(exam.id);
  expect(screen.getByTestId('exam-overall').props.children).toBe('75% overall — the pass mark is 75%.');
  expect(screen.getByTestId('exam-paper-use_of_english').props.accessibilityLabel).toBe('Use of English: 50%, the pass mark is 60%.');
  await fireEvent.press(screen.getByTestId('exam-done'));
  expect(onDone).toHaveBeenCalled();
});
