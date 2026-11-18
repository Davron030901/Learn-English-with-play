import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';

import ProgressScreen from '@/app/(tabs)/progress';
import { api } from '@/api/client';
import type { Learner } from '@/api/session';
import type { Unit } from '@/content/model';
import { ContentRepository } from '@/content/repository';
import { ProblemNotice, RouteErrorBoundary } from '@/features/errors';
import { FirstSentence } from '@/features/onboarding/FirstSentence';
import { SettingsPage } from '@/features/settings/SettingsPages';
import { buildExport, deleteEverythingOnDevice } from '@/features/settings/deviceData';
import { getOutbox } from '@/outbox';
import { EMPTY_LEARNER, useLearner } from '@/state/learner';
import { useOnlineStore } from '@/state/online';
import { usePrefs } from '@/state/prefs';

import { fsContentSource } from '../support/fsSource';
import { newQueryClient, renderUI } from './render';

const repo = new ContentRepository(fsContentSource);
let unit: Unit;
let words: ReadonlySet<string>;
let n = 0;
let learnerId = '';

beforeAll(async () => {
  [unit, words] = await Promise.all([repo.loadUnit('S01U01'), repo.loadWords()]);
});

beforeEach(async () => {
  await AsyncStorage.clear();
  n += 1;
  learnerId = `screen-learner-${n}`;
  useLearner.setState({ learnerId, data: { ...EMPTY_LEARNER, profile: { l1: 'uz', spellingVariant: 'us' } }, loaded: true });
});

test('Progress shows nothing it cannot back: coverage, level and streak are "Not available yet"', async () => {
  const qc = newQueryClient();
  qc.setQueryData(['content', 'course'], await repo.loadCourse());
  await renderUI(<ProgressScreen />, qc);
  expect(screen.getAllByText('Not available yet')).toHaveLength(3);
  expect(screen.getByText('Everyday English you understand')).toBeTruthy();
  expect(screen.getByTestId('where').props.children).toBe("You haven't started a lesson yet.");
  // No percentage, XP or streak count anywhere.
  expect(screen.queryByText(/\d+\s*(%|XP\b)|\d+[- ]day streak/i)).toBeNull();
});

test('step 8: the first sentence can be typed, is stored, and its timing kept', async () => {
  const onDone = jest.fn();
  await renderUI(<FirstSentence unit={unit} instructions={{}} words={words} onDone={onDone} />);
  expect(screen.getByTestId('first-sentence')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('type-instead'));
  await fireEvent.changeText(screen.getByTestId('speak-typed'), 'Hello! My name is Aziz.');
  await fireEvent.press(screen.getByTestId('check'));
  expect(screen.getByTestId('first-sentence-done')).toBeTruthy();
  expect(useLearner.getState().data.onboarding.firstSentenceMs).not.toBeNull();
  await waitFor(async () => expect(await getOutbox(learnerId).size()).toBe(1));
  await fireEvent.press(screen.getByTestId('first-sentence-path'));
  expect(onDone).toHaveBeenCalledTimes(1);
});

describe('the one error surface (acceptance A8, A9)', () => {
  test('copy comes from the type, the request id is shown, an unknown type gets generic copy', async () => {
    await renderUI(
      <>
        <ProblemNotice problem={{ type: 'dependency_unavailable', status: 503, requestId: 'req-503', errors: [], retryAfterS: null }} context="auth" />
        <ProblemNotice problem={{ type: 'http_418', status: 418, requestId: 'req-418', errors: [], retryAfterS: null }} />
      </>,
    );
    expect(screen.getByText("We can't sign you in right now — try again in a moment.")).toBeTruthy();
    expect(screen.getByText('Reference: req-503')).toBeTruthy();
    expect(screen.getByText('Something went wrong on our side. Please try again in a moment.')).toBeTruthy();
    expect(screen.getByText('Reference: req-418')).toBeTruthy();
  });

  test('a render error shows the recovery screen, never the stack', async () => {
    const error = new Error('boom at SecretComponent (src/x.tsx:12)');
    error.stack = 'Error: boom\n    at SecretComponent (src/x.tsx:12:3)';
    await renderUI(<RouteErrorBoundary error={error} retry={() => Promise.resolve()} />);
    expect(screen.getByText('This screen hit a problem')).toBeTruthy();
    expect(screen.queryByText(/SecretComponent|src\/x\.tsx/)).toBeNull();
  });
});

describe('the data exit (brief §8.4 guardrail 10)', () => {
  test('the export holds the device data and unsent answers, and never a token or birth year', async () => {
    useLearner.getState().markCompleted('S01U01N1', 1);
    await getOutbox(learnerId).enqueue({
      kind: 'review',
      client_uuid: 'u-1',
      created_at: '2026-10-01T08:00:00.000Z',
      monotonic_ms: 10,
      payload: {
        item_id: 'item.0000003',
        session_id: 'run',
        submission: { kind: 'choice', index: 1 },
        rt_ms: 900,
        hints_used: 0,
        plays_used: 0,
        started_at: '2026-10-01T07:59:59.000Z',
        content_version: 'sha256:x',
        local_verdict: 'correct',
        local_typo: false,
      },
    });
    const json = await buildExport(new Date('2026-10-01T09:00:00.000Z'));
    const doc = JSON.parse(json) as Record<string, unknown>;
    expect(doc.format).toBe('lep-device-export/1');
    expect((doc.unsent_answers as unknown[]).length).toBe(1);
    expect(JSON.stringify(doc.progress_on_this_device)).toContain('S01U01N1');
    expect(json).not.toMatch(/refresh_token|access_token|lep_rt_|birth|is_minor|password/i);
  });

  test('Me → Privacy → Export hands the file to the share sheet', async () => {
    await renderUI(<SettingsPage page="privacy" />);
    await fireEvent.press(screen.getByTestId('export-data'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledWith(expect.stringContaining('file:'), expect.objectContaining({ mimeType: 'application/json' })));
    expect(await screen.findByText('Your file is ready.')).toBeTruthy();
  });

  test("the export includes the account's own copy from the server, or says why it could not", async () => {
    const json = await buildExport(new Date('2026-10-01T09:00:00.000Z'), { data: { learner: { id: 'acc-1' }, review_attempts: [{ item_id: 'item.1' }] } });
    expect((JSON.parse(json) as { account_on_server: { learner: { id: string } } }).account_on_server.learner.id).toBe('acc-1');
    const offline = JSON.parse(await buildExport(new Date(), { unavailable: 'offline' })) as { account_on_server: unknown; note: string };
    expect(offline.account_on_server).toBeNull();
    expect(offline.note).toMatch(/could not be fetched/);
  });

  test('delete everything on this device removes every app key, the outbox and the progress', async () => {
    useLearner.getState().markCompleted('S01U01N1', 1);
    usePrefs.getState().set({ noAudio: true });
    await getOutbox(learnerId).enqueue({
      kind: 'dispute',
      client_uuid: 'd-1',
      created_at: '2026-10-01T08:00:00.000Z',
      monotonic_ms: 1,
      payload: { review_client_uuid: 'u-1', item_id: 'item.0000003' },
    });
    await deleteEverythingOnDevice();
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.filter((k) => k.startsWith('lep:learner') || k.startsWith('lep:outbox'))).toEqual([]);
    expect(useLearner.getState().learnerId).toBeNull();
    expect(useLearner.getState().data.completed).toEqual({});
    expect(usePrefs.getState().noAudio).toBe(false);
  });
});

// ------------------------------------------------------------------- the account's data controls

const ME_PRIVACY: Learner = {
  id: '00000000-0000-4000-8000-000000000007',
  email: 'learner@example.test',
  birth_year: 1995,
  created_at: '2026-09-01T00:00:00Z',
  daily_goal_min: 10,
  is_minor: false,
  l1: 'uz',
  status: 'active',
  tz: 'Asia/Tashkent',
  settings: { a11y_no_audio: false, a11y_no_vision: false, data_collection_paused: false, desired_retention: 0.9, leagues_opt_in: false, league_tier: 1, perfectionist_mode: false, rest_days: [7], spelling_variant: 'us', voice_consent: false, training_opt_in: false },
};

const okRes = <T,>(data: T, status = 200) => ({ data, error: undefined, response: { ok: true, status, headers: new Headers() } as Response });

async function renderPrivacy() {
  useOnlineStore.setState({ network: true, serverReachable: true });
  const qc = newQueryClient();
  qc.setQueryData(['me'], ME_PRIVACY);
  await renderUI(<SettingsPage page="privacy" />, qc);
}

describe("the account's data controls (docs/11 §10)", () => {
  afterEach(() => jest.restoreAllMocks());

  test("voice recordings, training use and pausing are the learner's own switches, sent to the server", async () => {
    const patch = jest.spyOn(api, 'PATCH').mockResolvedValue(okRes({}) as never);
    await renderPrivacy();
    expect(screen.getByText('Voice recordings')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('voice-consent'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/v1/me/settings', { body: { voice_consent: true } }));
    await waitFor(() => expect(screen.getByTestId('voice-consent').props.accessibilityState).toMatchObject({ checked: true }));
    await fireEvent.press(screen.getByTestId('data-paused'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/v1/me/settings', { body: { data_collection_paused: true } }));
    // training use is off unless the learner turns it on
    expect(screen.getByTestId('training-opt-in').props.accessibilityState).toMatchObject({ checked: false });
  });

  test('offline, the switches wait and say why', async () => {
    useOnlineStore.setState({ network: false, serverReachable: false });
    const qc = newQueryClient();
    qc.setQueryData(['me'], ME_PRIVACY);
    await renderUI(<SettingsPage page="privacy" />, qc);
    expect(screen.getByTestId('voice-consent').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Changing these needs a connection. Your current settings stay as they are.')).toBeTruthy();
  });

  test("the export asks the server for the account's copy, and says so when it could not be had", async () => {
    const get = jest.spyOn(api, 'GET').mockRejectedValue(new TypeError('Network request failed'));
    await renderPrivacy();
    await fireEvent.press(screen.getByTestId('export-data'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/v1/me/export'));
    await waitFor(() => expect(screen.getByTestId('export-account-missing')).toBeTruthy());
  });

  test('recordings are deleted on the server after a confirmation, and the count is shown', async () => {
    const del = jest.spyOn(api, 'DELETE').mockResolvedValue(okRes({ deleted: 3 }) as never);
    await renderPrivacy();
    await fireEvent.press(screen.getByTestId('delete-recordings'));
    expect(del).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('delete-recordings-confirm'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/v1/me/recordings'));
    await waitFor(() => expect(screen.getByText('3 recordings deleted.')).toBeTruthy());
  });

  test('deleting the account needs the password: a wrong one changes nothing, the right one clears the device', async () => {
    useLearner.getState().markCompleted('S01U01N1', 1);
    let attempts = 0;
    const post = jest.spyOn(api, 'POST').mockImplementation((async () => {
      attempts += 1;
      return attempts === 1
        ? { data: undefined, error: { type: 'invalid_credentials', status: 401 }, response: { ok: false, status: 401, headers: new Headers() } as Response }
        : { data: undefined, error: undefined, response: { ok: true, status: 204, headers: new Headers() } as Response };
    }) as never);
    await renderPrivacy();
    await fireEvent.press(screen.getByTestId('delete-account'));
    expect(screen.getByTestId('delete-account-confirm').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByTestId('delete-account-password'), 'not-my-password');
    await fireEvent.press(screen.getByTestId('delete-account-confirm'));
    await waitFor(() => expect(screen.getByText("That password isn't right.")).toBeTruthy());
    expect(useLearner.getState().data.completed).not.toEqual({});
    await fireEvent.changeText(screen.getByTestId('delete-account-password'), 'my-real-password');
    await fireEvent.press(screen.getByTestId('delete-account-confirm'));
    await waitFor(() => expect(useLearner.getState().learnerId).toBeNull());
    expect(post).toHaveBeenLastCalledWith('/v1/me/delete', { body: { password: 'my-real-password' } });
    expect(useLearner.getState().data.completed).toEqual({});
  });
});
