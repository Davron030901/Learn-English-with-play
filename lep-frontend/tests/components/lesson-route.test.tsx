import AsyncStorage from '@react-native-async-storage/async-storage';
import { screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import { api, session as authSession } from '@/api/client';
import type { SessionOut } from '@/api/types';
import LessonRoute from '@/app/lesson/[sessionId]';
import { ContentRepository } from '@/content/repository';
import { EMPTY_LEARNER, useLearner } from '@/state/learner';
import { useOnlineStore } from '@/state/online';
import { usePrefs } from '@/state/prefs';

import { fsContentSource } from '../support/fsSource';
import { newQueryClient, renderUI } from './render';

/**
 * Opening a lesson asks the server to compose it (POST /v1/sessions, docs/08 §5). The server's
 * gates are binding — tier 3 three days after tier 2, the day's cap on new material — and are
 * explained calmly; when the server cannot be asked, the device composes as before.
 */

const repo = new ContentRepository(fsContentSource);
const NODE = 'S01U01N2';

const problem = (status: number, body: Record<string, unknown>) => ({
  data: undefined,
  error: body,
  response: { ok: false, status, headers: new Headers() } as Response,
});

async function seeded() {
  const qc = newQueryClient();
  qc.setQueryData(['content', 'course'], await repo.loadCourse());
  qc.setQueryData(['content', 'words'], await repo.loadWords());
  qc.setQueryData(['content', 'unit', 'S01U01'], await repo.loadUnit('S01U01'));
  return qc;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useLearner.setState({ learnerId: 'route-learner', data: { ...EMPTY_LEARNER, profile: { l1: 'uz', spellingVariant: 'us' } }, loaded: true });
  useOnlineStore.setState({ network: true, serverReachable: true });
  jest.spyOn(authSession, 'getStatus').mockReturnValue('signedIn');
});

afterEach(() => {
  jest.restoreAllMocks();
  usePrefs.setState({ noAudio: false, noVision: false });
});

function open(tier: 1 | 2 | 3) {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ sessionId: `${NODE}.t${tier}` });
}

test("the server composes the lesson: the request names the node-tier and this device's profile, and the runner plays its plan", async () => {
  const unit = await repo.loadUnit('S01U01');
  const items = (unit.nodes.find((n) => n.id === NODE)?.tiers[1] ?? []).slice(0, 5);
  const plan: SessionOut = {
    id: 'srv-1',
    kind: 'node',
    status: 'open',
    minutes: 10,
    node_id: NODE,
    tier: 1,
    created_at: '2026-10-04T10:00:00Z',
    completed_at: null,
    estimated_seconds: 120,
    steps: items.map((it) => ({ role: 'lesson', phase: 'guided', seconds: 10, item_id: it.id, type_id: it.type_id, unit_id: 'S01U01', node_id: NODE, tier: 1, memory_item_id: null, target: null, modality: null, new_targets: [] })),
    new_targets: [],
    deferred: [],
    catching_up: null,
    new_today: 0,
    new_cap: 15,
    recovery: [],
    withheld: [],
    a11y_profile: { no_audio: false, no_vision: true },
  };
  usePrefs.setState({ noAudio: false, noVision: true });
  const post = jest.spyOn(api, 'POST').mockResolvedValue({ data: plan, error: undefined, response: { ok: true, status: 201, headers: new Headers() } as Response } as never);
  open(1);
  await renderUI(<LessonRoute />, await seeded());
  await waitFor(() => expect(screen.queryByTestId('lesson-loading')).toBeNull());
  const call = (post.mock.calls as unknown as [string, { body: Record<string, unknown> }][])[0];
  expect(call?.[0]).toBe('/v1/sessions');
  expect(call?.[1].body).toMatchObject({ node_id: NODE, tier: 1, a11y_profile: { no_audio: false, no_vision: true } });
  expect(screen.queryByTestId('lesson-not-found')).toBeNull();
  expect(screen.queryAllByTestId(/^exercise-|^present-/).length + screen.queryAllByTestId('got-it').length).toBeGreaterThan(0);
});

test('tier 3 before its three days: the day and time it opens, and reviews to do now', async () => {
  jest.spyOn(api, 'POST').mockResolvedValue(problem(409, { type: 'tier_locked', status: 409, available_at: '2026-10-07T04:00:00Z' }) as never);
  open(3);
  await renderUI(<LessonRoute />, await seeded());
  await waitFor(() => expect(screen.getByTestId('lesson-spaced')).toBeTruthy());
  expect(screen.getByText('Tier 3 opens soon')).toBeTruthy();
  expect(screen.getByText(/three days after tier 2, on .*7/)).toBeTruthy();
  expect(screen.getByText('Water the garden')).toBeTruthy();
});

test("the day's new material is used: no lesson, a calm reason, reviews offered", async () => {
  jest.spyOn(api, 'POST').mockResolvedValue(problem(409, { type: 'new_items_capped', status: 409 }) as never);
  open(1);
  await renderUI(<LessonRoute />, await seeded());
  await waitFor(() => expect(screen.getByTestId('lesson-capped')).toBeTruthy());
  expect(screen.getByText("That's today's new material")).toBeTruthy();
});

test('a server the device cannot reach: the lesson is composed on the device', async () => {
  jest.spyOn(api, 'POST').mockRejectedValue(new TypeError('Network request failed'));
  open(1);
  await renderUI(<LessonRoute />, await seeded());
  await waitFor(() => expect(screen.queryByTestId('lesson-loading')).toBeNull());
  expect(screen.queryByTestId('lesson-not-found')).toBeNull();
  expect(screen.queryByTestId('lesson-spaced')).toBeNull();
});

test('offline: the server is not asked at all', async () => {
  useOnlineStore.setState({ network: false, serverReachable: false });
  const post = jest.spyOn(api, 'POST');
  open(1);
  await renderUI(<LessonRoute />, await seeded());
  await waitFor(() => expect(screen.queryByTestId('lesson-loading')).toBeNull());
  expect(post).not.toHaveBeenCalledWith('/v1/sessions', expect.anything());
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function finishedOnDevice(tiers: Partial<Record<1 | 2 | 3, string>>) {
  useLearner.setState((s) => ({ data: { ...s.data, completed: { ...s.data.completed, [NODE]: tiers } } }));
}

test('the server has not heard of tier 1 yet, but this device just finished it: the device composes', async () => {
  jest.spyOn(api, 'POST').mockResolvedValue(problem(409, { type: 'tier_locked', status: 409 }) as never);
  finishedOnDevice({ 1: minutesAgo(5) });
  open(2);
  await renderUI(<LessonRoute />, await seeded());
  await waitFor(() => expect(screen.queryByTestId('lesson-loading')).toBeNull());
  expect(screen.queryByTestId('lesson-previous-tier')).toBeNull();
  expect(screen.queryByTestId('lesson-spaced')).toBeNull();
  expect(screen.queryByTestId('lesson-not-found')).toBeNull();
  // the device composed tier 2 and the lesson is playing
  expect(screen.queryAllByTestId(/^exercise-|^present-/).length + screen.queryAllByTestId('got-it').length).toBeGreaterThan(0);
});

test("an old device record is not enough: the server's answer stands (it records only passed tiers)", async () => {
  jest.spyOn(api, 'POST').mockResolvedValue(problem(409, { type: 'tier_locked', status: 409 }) as never);
  finishedOnDevice({ 1: minutesAgo(3 * 24 * 60) });
  open(2);
  await renderUI(<LessonRoute />, await seeded());
  await waitFor(() => expect(screen.getByTestId('lesson-previous-tier')).toBeTruthy());
});

test('tier 3 straight after tier 2 on this device still waits its three days', async () => {
  jest.spyOn(api, 'POST').mockResolvedValue(problem(409, { type: 'tier_locked', status: 409 }) as never);
  finishedOnDevice({ 1: minutesAgo(60), 2: minutesAgo(5) });
  open(3);
  await renderUI(<LessonRoute />, await seeded());
  await waitFor(() => expect(screen.getByTestId('lesson-spaced')).toBeTruthy());
  expect(screen.getByText('Tier 3 opens soon')).toBeTruthy();
});

test('a plan with reviews from a unit this app does not pack still plays', async () => {
  const unit = await repo.loadUnit('S01U01');
  const items = (unit.nodes.find((n) => n.id === NODE)?.tiers[1] ?? []).slice(0, 4);
  const step = (role: 'lesson' | 'review', id: string, unitId: string) => ({
    role,
    phase: role === 'lesson' ? ('guided' as const) : ('review' as const),
    seconds: 10,
    item_id: id,
    type_id: 'x',
    unit_id: unitId,
    node_id: null,
    tier: 1,
    memory_item_id: null,
    target: null,
    modality: null,
    new_targets: [],
  });
  const plan: SessionOut = {
    id: 'srv-2',
    kind: 'node',
    status: 'open',
    minutes: 10,
    node_id: NODE,
    tier: 1,
    created_at: '2026-10-04T10:00:00Z',
    completed_at: null,
    estimated_seconds: 120,
    steps: [step('review', 'item.from-a-newer-build', 'S99U99'), ...items.map((it) => step('lesson', it.id, 'S01U01'))],
    new_targets: [],
    deferred: [],
    catching_up: null,
    new_today: 0,
    new_cap: 15,
    recovery: [],
    withheld: [],
    a11y_profile: { no_audio: false, no_vision: false },
  };
  jest.spyOn(api, 'POST').mockResolvedValue({ data: plan, error: undefined, response: { ok: true, status: 201, headers: new Headers() } as Response } as never);
  open(1);
  await renderUI(<LessonRoute />, await seeded());
  await waitFor(() => expect(screen.queryByTestId('lesson-loading')).toBeNull());
  expect(screen.queryByTestId('lesson-not-found')).toBeNull();
  expect(screen.queryAllByTestId(/^exercise-|^present-/).length + screen.queryAllByTestId('got-it').length).toBeGreaterThan(0);
});
