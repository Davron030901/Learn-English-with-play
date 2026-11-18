import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { api } from '@/api/client';
import type { ExamReportOut } from '@/api/types';
import { ExamReport } from '@/features/assessment/ExamReport';

import { renderUI } from './render';

/**
 * The report after a level exam (docs/12 §9.2–9.3): every number with what it means, nothing
 * the evidence does not support — a skill not assessed is "not assessed", never 0 %; no
 * comparison with other learners; no estimate without a pace.
 */

const EXAM = '0193d000-0000-7000-8000-0000000000e1';

function report(over: Partial<ExamReportOut> = {}): ExamReportOut {
  return {
    id: EXAM,
    level: 'A1',
    completed_at: '2026-10-09T10:00:00Z',
    passed: false,
    overall: 0.5,
    papers: [
      { paper: 'use_of_english', score: 0, asked: 15, answered: 15, correct: 0, paper_bar: 0.6, overall_bar: 0.75, band: 'below', median_seconds: 6.2 },
      { paper: 'reading', score: 1, asked: 15, answered: 15, correct: 15, paper_bar: 0.6, overall_bar: 0.75, band: 'secure', median_seconds: 5 },
      { paper: 'listening', score: 0.5, asked: 12, answered: 0, correct: 0, paper_bar: 0.6, overall_bar: 0.75, band: 'below', median_seconds: null },
    ],
    skills: [
      { skill: 'listening', value: 0.5, target: 0.75, scale: 'share' },
      { skill: 'reading', value: 1, target: 0.75, scale: 'share' },
      { skill: 'language', value: 0, target: 0.75, scale: 'share' },
      { skill: 'writing', value: null, target: 1, scale: 'band' },
      { skill: 'speaking', value: null, target: 1, scale: 'band' },
    ],
    error_types: [{ kind: 'grammar', asked: 12, wrong: 7 }],
    work_on: [
      { target: 'G-001', kind: 'grammar', wrong: 3, asked: 3, label: 'to be — am, is, are', unit_id: 'S01U01' },
      { target: 'lex.00042', kind: 'vocabulary', wrong: 1, asked: 2, label: null, unit_id: null },
    ],
    vocabulary: { known_lexemes: 140, level_known: 120, level_total: 800, estimate_percent: 41.6 },
    fluency: { reading_target_wpm: '55–75', speech_target_wpm: '50–65', speech_rate_wpm: null },
    timeline: { next_level: 'A2', units_left: 30, units_per_week: null, weeks: null, reason: 'no_pace' },
    note: 'An internal assessment, not an accredited qualification.',
    ...over,
  };
}

const ok = <T,>(data: T) => ({ data, error: undefined, response: { ok: true, status: 200, headers: new Headers() } as Response });

afterEach(() => jest.restoreAllMocks());

test('every number says what it means; nothing unassessed is shown as zero', async () => {
  const get = jest.spyOn(api, 'GET').mockImplementation((async () => ok(report())) as never);
  await renderUI(<ExamReport examId={EXAM} onBack={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId('exam-report')).toBeTruthy());
  expect(get).toHaveBeenCalledWith('/v1/assessment/exams/{exam_id}/report', { params: { path: { exam_id: EXAM } } });
  expect(screen.getByText(/internal assessment by the app, not an accredited qualification/)).toBeTruthy();
  expect(screen.getByText(/Read it with each paper below/)).toBeTruthy();
  expect(screen.getByText('Secure — well above what the level asks.')).toBeTruthy();
  expect(screen.getAllByText("Below the paper's minimum.")).toHaveLength(2);
  expect(screen.getByText(/About 6 seconds an answer/)).toBeTruthy();
  expect(screen.getByTestId('exam-report-skill-writing-none')).toBeTruthy();
  expect(screen.getByTestId('exam-report-skill-speaking-none')).toBeTruthy();
  expect(screen.queryByText(/Band 0/)).toBeNull();
  expect(screen.getByText('grammar: 7 wrong of 12')).toBeTruthy();
  expect(screen.getByText(/there aren't enough yet, so no comparison is shown/)).toBeTruthy();
  expect(screen.getByText(/This is an estimate/)).toBeTruthy();
  expect(screen.getByText(/measured once recorded speech can be scored/)).toBeTruthy();
  expect(screen.getByTestId('exam-report-timeline').props.children).toBe(
    '30 units left to the end of A2. Finish a few units and an estimate will appear.',
  );
  // a target the content names opens its unit; one it does not is shown by its id, not opened
  await fireEvent.press(screen.getByTestId('exam-report-work-G-001'));
  expect(router.push).toHaveBeenCalledWith('/unit/S01U01');
  expect(screen.getByText('lex.00042')).toBeTruthy();
});

test('with a pace the timeline is an estimate in weeks; C2 has no next level', async () => {
  jest.spyOn(api, 'GET').mockImplementation((async () =>
    ok(report({ timeline: { next_level: 'A2', units_left: 12, units_per_week: 2, weeks: 6, reason: '' } }))) as never);
  await renderUI(<ExamReport examId={EXAM} onBack={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId('exam-report-timeline')).toBeTruthy());
  expect(screen.getByTestId('exam-report-timeline').props.children).toBe(
    'About 6 weeks to the end of A2 at your pace of 2 units a week (12 units left).',
  );
});

test('an unfinished exam has no report yet, and says so', async () => {
  jest.spyOn(api, 'GET').mockImplementation((async () => ({
    data: undefined,
    error: { type: 'assessment_conflict', status: 409, reason: 'incomplete' },
    response: { ok: false, status: 409, headers: new Headers() } as Response,
  })) as never);
  await renderUI(<ExamReport examId={EXAM} onBack={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId('exam-report-error')).toBeTruthy());
});
