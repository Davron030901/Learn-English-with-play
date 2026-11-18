import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { api, publicApi, session } from '@/api/client';
import type { Unit } from '@/content/model';
import { ContentRepository } from '@/content/repository';
import type { Item } from '@/content/schemas';
import { ExerciseView } from '@/exercises/ExerciseView';
import {
  PronunciationCard,
  parseResult,
  substitutions,
  type CheckState,
} from '@/exercises/pronunciation';
import type { ExerciseContext } from '@/exercises/types';
import type { GradeResult, Submission } from '@/grading/grade';

import { fsContentSource } from '../support/fsSource';
import { renderUI } from './render';

jest.mock('@/audio/recordingData', () => ({
  RECORDING_MIME: 'audio/mp4',
  recordingBase64: jest.fn(() => Promise.resolve('QUJD')),
}));

/**
 * Pronunciation scored on the server (frontend DECISIONS §25): only with the server's scorer,
 * the learner's consent and a connection; after the answer, never in the lesson's way; one
 * headline, at most two notes, each word; otherwise speaking is exactly as before.
 */

const repo = new ContentRepository(fsContentSource);
let u1: Unit;
beforeAll(async () => {
  u1 = await repo.loadUnit('S01U01');
});

const SCORED = {
  headline: 74,
  passed: false,
  notes: ["In 'hello', /h/ sounded like /x/."],
  words: [
    {
      word: 'hello',
      score: 61.4,
      phones: [{ expected: 'h', heard: 'x', gop: -3, contrastive: true, substituted: true }],
    },
    { word: 'Aziz', score: 90, phones: [] },
  ],
  stress_accuracy: 1,
  intelligibility: 0.9,
  transcript: 'hello aziz',
  scorer: 'test',
};
const JOB = {
  id: '0193d000-0000-7000-8000-00000000a0b1',
  status: 'queued',
  purpose: 'pronunciation',
  expires_at: '2026-11-08T10:00:00Z',
  result: null,
};

const ok = <T,>(data: T, status = 200) => ({
  data,
  error: undefined,
  response: { ok: true, status, headers: new Headers() } as Response,
});

function serverWith(opts: { scoring: boolean; consent: boolean }) {
  jest.spyOn(session, 'getStatus').mockReturnValue('signedIn');
  jest.spyOn(publicApi, 'GET').mockImplementation((async () =>
    ok({
      ai_partner: false,
      tts: false,
      speech_scoring: opts.scoring,
      password_reset: false,
      web_refresh_cookie: false,
      breached_password_check: 'built_in',
      content_version: 'sha256:x',
    })) as never);
  let polls = 0;
  const get = jest.spyOn(api, 'GET').mockImplementation((async (path: string) => {
    if (path === '/v1/me')
      return ok({
        id: 'l1',
        settings: { voice_consent: opts.consent, data_collection_paused: false },
      });
    if (path === '/v1/media/jobs/{job_id}') {
      polls += 1;
      return ok(polls < 2 ? JOB : { ...JOB, status: 'scored', result: SCORED });
    }
    throw new Error(`unexpected GET ${path}`);
  }) as never);
  const post = jest.spyOn(api, 'POST').mockImplementation((async () => ok(JOB, 202)) as never);
  return { get, post };
}

function repeatAfter(): Item {
  const item = u1.nodes
    .flatMap((n) => Object.values(n.tiers).flat())
    .find((i): i is Item => i?.type_id === 'repeat_after');
  if (!item) throw new Error('no repeat_after item');
  return item;
}

const ctx = (): ExerciseContext => ({
  unit: u1,
  cefr: u1.cefr,
  l1: 'uz',
  english: new Set(),
  profile: { noAudio: false, noVision: false },
  accent: 'us',
  speed: 1,
  timers: 'default',
  timedMode: false,
  whisper: false,
  seed: 1,
  reduceMotion: true,
});

async function speakAndSubmit(item: Item) {
  const onSubmit = jest.fn<void, [Submission]>();
  const view = await renderUI(
    <ExerciseView
      item={item}
      ctx={ctx()}
      result={null}
      plays={0}
      onPlay={jest.fn()}
      hint={null}
      onSubmit={onSubmit}
      instruction="Say it."
    />,
  );
  await fireEvent.press(screen.getByTestId('mic'));
  await fireEvent.press(screen.getByTestId('mic'));
  await waitFor(() => expect(screen.getByTestId('speak-submit')).toBeTruthy());
  return { onSubmit, view };
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('with a scorer and consent, the take is sent after the answer and checked', async () => {
  const { post, get } = serverWith({ scoring: true, consent: true });
  const item = repeatAfter();
  const { onSubmit, view } = await speakAndSubmit(item);
  await waitFor(() => expect(screen.getByText(/sent to check your pronunciation/)).toBeTruthy());
  jest.useFakeTimers();
  await fireEvent.press(screen.getByTestId('speak-submit'));
  expect(onSubmit).toHaveBeenCalledWith({ kind: 'speech', modality: 'voice' });
  await act(async () => {
    await Promise.resolve();
  });
  expect(post).toHaveBeenCalledWith('/v1/media/speech', {
    body: {
      purpose: 'pronunciation',
      item_id: item.id,
      audio_base64: 'QUJD',
      mime: 'audio/mp4',
      seconds: 2,
    },
  });
  // the answer is in: the item locks and shows the check beside the feedback
  const result = { verdict: 'ungraded', typo: null } as GradeResult;
  await view.rerender(
    <ExerciseView
      item={item}
      ctx={ctx()}
      result={result}
      plays={0}
      onPlay={jest.fn()}
      hint={null}
      onSubmit={onSubmit}
      instruction="Say it."
    />,
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3_000);
  });
  await waitFor(() => expect(screen.getByTestId('pronunciation-result')).toBeTruthy());
  expect(get).toHaveBeenCalledWith('/v1/media/jobs/{job_id}', {
    params: { path: { job_id: JOB.id } },
  });
  expect(screen.getByTestId('pronunciation-headline').props.children).toBe(
    'Pronunciation: 74 out of 100',
  );
  expect(screen.getAllByTestId('pronunciation-note').map((n) => n.props.children)).toEqual([
    'In “hello”, /h/ sounded like /x/.',
  ]);
  expect(screen.getByTestId('pronunciation-words').props.children).toBe('hello 61 · Aziz 90');
});

test('without consent, or without a scorer, nothing leaves the device', async () => {
  for (const opts of [
    { scoring: true, consent: false },
    { scoring: false, consent: true },
  ]) {
    const { post } = serverWith(opts);
    const { onSubmit, view } = await speakAndSubmit(repeatAfter());
    expect(screen.getByText(/stay on this device/i)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('speak-submit'));
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'speech', modality: 'voice' });
    expect(post).not.toHaveBeenCalled();
    await view.unmount();
    jest.restoreAllMocks();
  }
});

test('the card: a refusal is said with its reason; a failure never blames the learner', async () => {
  const states: CheckState[] = [
    {
      kind: 'failed',
      problem: {
        type: 'media_refused',
        status: 409,
        requestId: null,
        errors: [],
        retryAfterS: null,
        reason: 'ceiling',
      },
    },
    { kind: 'failed', problem: null },
  ];
  const view = await renderUI(<PronunciationCard state={states[0] as CheckState} />);
  expect(screen.getByText("That's today's recording time. More tomorrow.")).toBeTruthy();
  await view.rerender(<PronunciationCard state={states[1] as CheckState} />);
  expect(screen.getByText(/couldn't be checked this time. Your answer still counts/)).toBeTruthy();
});

test('a malformed result is no result, and notes are at most two', () => {
  expect(parseResult(null)).toBeNull();
  expect(parseResult({ headline: 'high' } as never)).toBeNull();
  const many = parseResult({
    headline: 140,
    passed: true,
    words: [1, 2, 3].map((k) => ({
      word: `w${k}`,
      score: 50,
      phones: [{ expected: 'a', heard: 'e', substituted: true }],
    })),
  } as never);
  expect(many?.headline).toBe(100);
  expect(substitutions(many as NonNullable<typeof many>)).toHaveLength(2);
});
