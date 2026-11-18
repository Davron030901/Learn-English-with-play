import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import type { ScoreOut, SubmissionOut, WritingTaskOut } from '@/api/types';
import { WritingTasks, wordCount } from '@/features/assessment/Writing';
import { EMPTY_LEARNER, useLearner } from '@/state/learner';

import { newQueryClient, renderUI } from './render';

/**
 * Writing for a level (docs/12 §5): a task, a word count the server would agree with, a score
 * with every criterion's evidence from the learner's own text, an honest "practice feedback"
 * label for an uncalibrated rater, and an appeal that can be sent once.
 */

const TASK: WritingTaskOut = { id: 'w.A1.1', level: 'A1', prompt: 'Write to a new friend. Say your name, where you live, and what you like.', min_words: 25, max_words: 60 };
const TEXT = 'Hello! My name is Ali. I live in Tashkent with my family. I like tea, football and books. On Sunday I play football in the park with my friends. What do you like?';

const SCORE: ScoreOut = {
  id: '0193c000-0000-7000-8000-00000000a001',
  kind: 'writing',
  level: 'A1',
  overall: 1.5,
  criteria: [
    { criterion: 'task_achievement', band: 2, evidence: ['My name is Ali.'] },
    { criterion: 'coherence', band: 1.5, evidence: ['I live in Tashkent with my family.'] },
    { criterion: 'lexis', band: 1.5, evidence: ['I like tea, football and books.'] },
    { criterion: 'grammar', band: 1, evidence: ['On Sunday I play football in the park with my friends.'] },
    { criterion: 'register', band: 2, evidence: ['What do you like?'] },
  ],
  rater: 'llm / test',
  certifying: false,
  borderline: false,
  created_at: '2026-10-06T10:00:00Z',
};

const ok = <T,>(data: T, status = 200) => ({ data, error: undefined, response: { ok: true, status, headers: new Headers() } as Response });

beforeEach(async () => {
  await AsyncStorage.clear();
  useLearner.setState({ learnerId: 'writing-learner', data: { ...EMPTY_LEARNER, profile: { l1: 'uz', spellingVariant: 'us' } }, loaded: true });
});

afterEach(() => jest.restoreAllMocks());

function seeded() {
  const qc = newQueryClient();
  qc.setQueryData(['writing', 'tasks', 'A1'], [TASK]);
  return qc;
}

async function writeAndSend(text: string) {
  await fireEvent.press(screen.getByTestId('writing-task-w.A1.1'));
  await fireEvent.changeText(screen.getByTestId('writing-text'), text);
  await fireEvent.press(screen.getByTestId('writing-submit'));
}

test('words are counted as the server counts them', () => {
  expect(wordCount('  Hello!  My name   is Ali. ')).toBe(5);
  expect(wordCount('')).toBe(0);
});

test('a score shows every criterion with the learner\'s own sentences, says when it is only practice, and can be appealed once', async () => {
  const post = jest.spyOn(api, 'POST').mockImplementation((async (path: string) => {
    if (path === '/v1/assessment/writing') return ok<SubmissionOut>({ submission_id: 's-1', status: 'scored', score: SCORE }, 201);
    if (path === '/v1/assessment/appeals') return ok({ id: 'ap-1', score_id: SCORE.id, status: 'open' }, 201);
    throw new Error(`unexpected ${path}`);
  }) as never);
  await renderUI(<WritingTasks level="A1" onDone={jest.fn()} />, seeded());
  expect(screen.getByText(TASK.prompt)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('writing-task-w.A1.1'));
  expect(screen.getByTestId('writing-submit').props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.changeText(screen.getByTestId('writing-text'), TEXT);
  expect(screen.getByTestId('writing-count').props.children).toBe('33 words · aim for 25–60');
  await fireEvent.press(screen.getByTestId('writing-submit'));
  await waitFor(() => expect(screen.getByTestId('writing-result')).toBeTruthy());
  expect(post).toHaveBeenCalledWith('/v1/assessment/writing', { body: { task_id: 'w.A1.1', text: TEXT } });
  expect(screen.getByTestId('writing-overall').props.children).toBe('Band 1.5');
  expect(screen.getByText('Task achievement')).toBeTruthy();
  expect(screen.getByText('“My name is Ali.”')).toBeTruthy();
  expect(screen.getByTestId('writing-formative')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('writing-appeal'));
  await fireEvent.changeText(screen.getByTestId('writing-appeal-reason'), 'My grammar was right.');
  await fireEvent.press(screen.getByTestId('writing-appeal-send'));
  await waitFor(() => expect(screen.getByTestId('writing-appealed')).toBeTruthy());
  expect(post).toHaveBeenLastCalledWith('/v1/assessment/appeals', { body: { score_id: SCORE.id, reason: 'My grammar was right.' } });
});

test('with no rater available the writing is kept and says when it will count', async () => {
  jest.spyOn(api, 'POST').mockResolvedValue(ok<SubmissionOut>({ submission_id: 's-2', status: 'awaiting_rater', score: null }, 201) as never);
  await renderUI(<WritingTasks level="A1" onDone={jest.fn()} />, seeded());
  await writeAndSend(TEXT);
  await waitFor(() => expect(screen.getByTestId('writing-awaiting')).toBeTruthy());
  expect(screen.getByText('Your writing is saved')).toBeTruthy();
});

test('while data collection is paused the refusal says so, and how to change it', async () => {
  jest.spyOn(api, 'POST').mockResolvedValue({
    data: undefined,
    error: { type: 'assessment_conflict', status: 409, reason: 'paused', detail: 'data collection is paused' },
    response: { ok: false, status: 409, headers: new Headers() } as Response,
  } as never);
  await renderUI(<WritingTasks level="A1" onDone={jest.fn()} />, seeded());
  await writeAndSend(TEXT);
  await waitFor(() =>
    expect(screen.getByText("Data collection is paused, so writing can't be sent. You can change this in Me → Privacy and data.")).toBeTruthy(),
  );
});
