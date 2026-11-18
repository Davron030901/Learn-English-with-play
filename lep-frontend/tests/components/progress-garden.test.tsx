import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import ProgressScreen from '@/app/(tabs)/progress';
import ReviewRoute from '@/app/review';
import { api, session as authSession } from '@/api/client';
import type { DueQueue, GamificationSummary, GardenBeds, GardenSummary, LevelAwardOut, Plant, ProgressOut, ShopOut } from '@/api/types';
import type { Learner } from '@/api/session';
import { content } from '@/content/queries';
import { ContentRepository } from '@/content/repository';
import { ThemeProvider, useTheme, type ThemeAccent } from '@/design';
import { colors } from '@/design/tokens.generated';
import { Garden } from '@/features/garden/Garden';
import { SettingsPage } from '@/features/settings/SettingsPages';
import { useA11yProfileSync } from '@/features/settings/useA11yProfileSync';
import { accentFromShop, useCosmeticSync } from '@/features/settings/useCosmeticSync';
import { getOutbox } from '@/outbox';
import { syncNow } from '@/outbox/syncer';
import { EMPTY_LEARNER, useLearner } from '@/state/learner';
import { useOnlineStore } from '@/state/online';
import { usePrefs } from '@/state/prefs';

import { fsContentSource } from '../support/fsSource';
import { newQueryClient, renderUI } from './render';

/**
 * Engineer B's screens (docs/16 E03, E09, E15, E17): Progress puts coverage first and shows
 * "Not available yet" rather than a guess; the garden labels every plant in words; an empty
 * review says the garden is watered; learning settings go to the server, and the account keeps a
 * copy of the device's accessibility profile; a shop theme re-tints only the primary role.
 */

const repo = new ContentRepository(fsContentSource);
const DAY = 86_400_000;
let n = 0;

beforeEach(async () => {
  await AsyncStorage.clear();
  n += 1;
  useLearner.setState({ learnerId: `progress-learner-${n}`, data: { ...EMPTY_LEARNER, profile: { l1: 'uz', spellingVariant: 'us' } }, loaded: true });
  useOnlineStore.setState({ network: true, serverReachable: true });
  usePrefs.setState({ accent: 'default', celebrations: 'full', noAudio: false, noVision: false });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const ok = <T,>(data: T) => ({ data, error: undefined, response: { ok: true, status: 200, headers: new Headers() } as Response });

function summary(over: Partial<GamificationSummary> = {}): GamificationSummary {
  return {
    as_of: '2026-10-04T09:30:00Z',
    today: '2026-10-04',
    daily_quests: [],
    weekly_quests: [],
    gems: 40,
    goal: { goal_min: 10, met: false, met_now: false, minutes_today: 4 },
    streak: { can_repair: false, current: 6, longest: 12, freezes: 1, milestone_now: null, paused_until: null, reset_message: null, rest_days: [7], today_counted: false },
    unseen_badges: [],
    xp_today: 35,
    xp_week: 240,
    xp_total: 1820,
    ...over,
  };
}

const BADGE = { id: 'S01U01:1', unit_id: 'S01U01', text: 'I can greet people and say my name.', awarded_at: '2026-10-01T10:00:00Z' };

const PROGRESS: ProgressOut = {
  coverage: { audited: false, estimate_percent: 38.4, known_lexemes: 212, learning_lexemes: 40, method: 'weakest-aspect', total_lexemes: 3000 },
  level: { cefr: 'A1', percent: 25, units_done: 2, units_total: 8 },
  current_unit: 'S01U03',
  units: [],
  badges: [BADGE],
};

// ------------------------------------------------------------------- Progress

test("the level card shows the four award conditions with the server's values, in the learner's words", async () => {
  const qc = newQueryClient();
  qc.setQueryData(['content', 'course'], await repo.loadCourse());
  qc.setQueryData(['progress'], PROGRESS);
  qc.setQueryData(['gamification', 'summary'], summary());
  const award: LevelAwardOut = {
    level: 'A1',
    awarded: false,
    conditions: [
      { name: 'coverage', passed: true, value: 0.97, threshold: 0.95, shortfall: '' },
      { name: 'retention', passed: false, value: 0.6, threshold: 0.85, shortfall: '40 more memory items' },
      { name: 'exam', passed: true, value: 0.81, threshold: 0.75, shortfall: '' },
      { name: 'production', passed: false, value: null, threshold: 1, shortfall: 'no writing yet' },
    ],
    message: 'You passed the test, but a lot of this is still fragile.',
    remediation: [],
    recorded: false,
  };
  qc.setQueryData(['progress', 'level', 'A1'], award);
  await renderUI(<ProgressScreen />, qc);
  expect(screen.getByText('What the A1 award asks for')).toBeTruthy();
  expect(screen.getByTestId('level-condition-coverage').props.accessibilityLabel).toBe(
    "Coverage: met. 97% of the level's syllabus passed at tier 2 — it needs 95%.",
  );
  expect(screen.getByTestId('level-condition-retention').props.accessibilityLabel).toBe(
    "Retention: not yet. 60% of what you've learned is remembered well — it needs 85%.",
  );
  expect(screen.getByText("Writing and speaking haven't been scored yet — they need band 1.")).toBeTruthy();
  // the exam passed on fragile memory: the honest docs/12 §4.3 sentence, in the learner's language
  expect(screen.getByTestId('level-fragile')).toBeTruthy();
  // the server's English shortfall sentences are never shown
  expect(screen.queryByText(/40 more memory items|no writing yet/)).toBeNull();
});

test('Progress without the server: three "Not available yet" cards and no number of its own', async () => {
  const qc = newQueryClient();
  qc.setQueryData(['content', 'course'], await repo.loadCourse());
  await renderUI(<ProgressScreen />, qc);
  expect(screen.getAllByText('Not available yet')).toHaveLength(3);
  expect(screen.queryByTestId('coverage')).toBeNull();
  expect(screen.queryByTestId('xp')).toBeNull();
  expect(screen.queryByText(/\d+\s*(%|XP\b)|\d+[- ]day streak/i)).toBeNull();
});

test('Progress from the server: coverage first, then level, streak, XP and the passport; new stamps are marked seen', async () => {
  const post = jest.spyOn(api, 'POST').mockResolvedValue(ok(undefined) as never);
  const qc = newQueryClient();
  qc.setQueryData(['content', 'course'], await repo.loadCourse());
  qc.setQueryData(['progress'], PROGRESS);
  qc.setQueryData(['gamification', 'summary'], summary({ unseen_badges: [BADGE] }));
  await renderUI(<ProgressScreen />, qc);

  expect(screen.queryByText('Not available yet')).toBeNull();
  const tree = JSON.stringify(screen.toJSON());
  const at = (id: string) => tree.indexOf(`"testID":"${id}"`);
  for (const id of ['coverage', 'level', 'streak', 'xp', 'passport-S01U01']) expect(at(id)).toBeGreaterThan(-1);
  expect(at('coverage')).toBeLessThan(at('level'));
  expect(at('level')).toBeLessThan(at('streak'));
  expect(at('streak')).toBeLessThan(at('xp'));
  expect(at('xp')).toBeLessThan(at('passport-S01U01'));

  // The coverage figure is labelled an estimate, in words a screen reader can say.
  expect(screen.getByTestId('coverage').props.accessibilityLabel).toBe(
    'You know about 212 words, about 38 percent of everyday English. An estimate until your first retention audit checks it.',
  );
  expect(screen.getByText('Estimate')).toBeTruthy();
  expect(screen.getByTestId('xp').props.accessibilityLabel).toBe('XP: 35 today, 240 this week, 1820 in total.');
  expect(screen.getByTestId('streak-current').props.children).toBe('6-day streak');

  // The stamp is new on this visit and is reported seen once.
  expect(screen.getByText('New')).toBeTruthy();
  await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/gamification/badges/seen', { body: { ids: ['S01U01:1'] } }));
  expect((post.mock.calls as unknown as [string, unknown][]).filter(([path]) => path === '/v1/gamification/badges/seen')).toHaveLength(1);
});

test('streak care: pausing sends the chosen number of days, with no confirmation step', async () => {
  const post = jest.spyOn(api, 'POST').mockResolvedValue(ok(summary()) as never);
  const qc = newQueryClient();
  qc.setQueryData(['gamification', 'summary'], summary());
  await renderUI(<ProgressScreen />, qc);
  await fireEvent.press(screen.getByTestId('pause-more'));
  expect(screen.getByTestId('pause-days').props.children).toBe('8 days');
  await fireEvent.press(screen.getByTestId('streak-pause'));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/gamification/streak/pause', { body: { days: 8 } }));
});

// ------------------------------------------------------------------- the garden

function plant(over: Partial<Plant> & Pick<Plant, 'lexeme_id' | 'lemma' | 'stage'>): Plant {
  return { aspects: { recog: 'retained' }, due_at: new Date(Date.now() + 11.5 * DAY).toISOString(), health: 0.95, thirsty: false, ...over };
}

test('the garden draws the server stages and labels each plant with its stage and health', async () => {
  const qc = newQueryClient();
  const g: GardenSummary = { as_of: '2026-10-04T09:30:00Z', audited: false, due_count: 2, est_minutes: 3, stages: { seed: 1, sprout: 0, bush: 1, bloom: 0, tree: 1, leech: 0, paused: 0 } };
  const beds: GardenBeds = {
    next_cursor: null,
    beds: [
      {
        unit_id: 'S01U01',
        title: { en: 'Hello!' },
        plants: [
          plant({ lexeme_id: 'lx-hello', lemma: 'hello', stage: 'bush' }),
          plant({ lexeme_id: 'lx-name', lemma: 'name', stage: 'seed', thirsty: true, health: 0.5, due_at: new Date(Date.now() - DAY).toISOString() }),
          plant({ lexeme_id: 'lx-tea', lemma: 'tea', stage: 'tree', thirsty: true, health: 0.82, due_at: new Date(Date.now() - DAY).toISOString(), aspects: { recog: 'durable', aural: 'retained', recall: 'learning' } }),
        ],
      },
    ],
  };
  qc.setQueryData(['garden', 'summary'], g);
  qc.setQueryData(['garden', 'beds', 0, null], beds);
  await renderUI(<Garden />, qc);

  expect(screen.getByTestId('garden-weather')).toBeTruthy();
  expect(screen.getByTestId('water')).toBeTruthy();
  expect(screen.getByTestId('stage-bush').props.accessibilityLabel).toMatch(/Known/);
  expect(screen.getByTestId('plant-lx-hello').props.accessibilityLabel).toBe('hello, Known, next review in 12 days');
  expect(screen.getByTestId('plant-lx-name').props.accessibilityLabel).toBe('name, Learning, very thirsty');
  expect(screen.getByTestId('plant-lx-tea').props.accessibilityLabel).toMatch(/^tea, Mastered, /);

  // A plant opens its sheet: every side of the word is said in words, the weakest one named.
  await fireEvent.press(screen.getByTestId('plant-lx-tea'));
  expect(screen.getByTestId('plant-sheet')).toBeTruthy();
  expect(screen.getByTestId('aspect-recall').props.accessibilityLabel).toMatch(/recall|Recall/);
  expect(screen.getByTestId('weakest')).toBeTruthy();
});

test('the garden says so instead of guessing when the server has no garden', async () => {
  await renderUI(<Garden />);
  expect(screen.getByTestId('garden-unavailable')).toBeTruthy();
  expect(screen.getByText('Not available yet')).toBeTruthy();
});

// ------------------------------------------------------------------- review

test('an empty review queue says the garden is watered', async () => {
  const qc = newQueryClient();
  const due: DueQueue = { as_of: '2026-10-04T09:30:00Z', items: [], total_due: 0 };
  qc.setQueryData(['due', 15], due);
  await renderUI(<ReviewRoute />, qc);
  expect(screen.getByTestId('review-empty')).toBeTruthy();
  expect(screen.getByText('Your garden is watered')).toBeTruthy();
});

test('review without the server or a saved window: a calm pending state, never an invented queue', async () => {
  await renderUI(<ReviewRoute />);
  await waitFor(() => expect(screen.getByTestId('review-offline')).toBeTruthy());
});

test('offline, the garden is watered from the reviews the last sync said would be due', async () => {
  useOnlineStore.setState({ network: false, serverReachable: false });
  const unit = await repo.loadUnit('S01U01');
  const items = (unit.nodes[0]?.tiers[1] ?? []).filter((it) => it.type_id.startsWith('mcq_')).slice(0, 2);
  expect(items).toHaveLength(2);
  const learnerId = useLearner.getState().learnerId as string;
  const past = new Date(Date.now() - DAY).toISOString();
  const future = new Date(Date.now() + 3 * DAY).toISOString();
  await AsyncStorage.setItem(
    `lep:learner:${learnerId}:due-window`,
    JSON.stringify({
      asOf: new Date(Date.now() - 2 * DAY).toISOString(),
      contentVersion: 'sha256:test',
      due: [
        { memoryItemId: 'lex.00001.recall', itemId: items[0]?.id, dueAt: past },
        { memoryItemId: 'lex.00002.recall', itemId: items[1]?.id, dueAt: future },
      ],
    }),
  );
  jest.spyOn(content, 'loadUnit').mockImplementation((id: string) => repo.loadUnit(id));
  const qc = newQueryClient();
  qc.setQueryData(['content', 'course'], await repo.loadCourse());
  qc.setQueryData(['content', 'words'], await repo.loadWords());
  await renderUI(<ReviewRoute />, qc);
  await waitFor(() => expect(screen.queryByTestId('review-loading')).toBeNull(), { timeout: 10_000 });
  expect(screen.queryByTestId('review-offline')).toBeNull();
  expect(screen.queryByTestId('review-empty')).toBeNull();
  // the one review that has come due is playing; the one due in three days is not
  expect(screen.queryAllByTestId(/^exercise-/).length).toBeGreaterThan(0);
});

// ------------------------------------------------------------------- learning settings

const ME: Learner = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'learner@example.test',
  birth_year: 1995,
  created_at: '2026-09-01T00:00:00Z',
  daily_goal_min: 10,
  is_minor: false,
  l1: 'uz',
  status: 'active',
  tz: 'Asia/Tashkent',
  settings: { a11y_no_audio: false, a11y_no_vision: false, data_collection_paused: false, desired_retention: 0.9, leagues_opt_in: false, league_tier: 1, perfectionist_mode: false, rest_days: [6, 7], spelling_variant: 'us', voice_consent: false, training_opt_in: false },
};

async function renderLearning() {
  const qc = newQueryClient();
  qc.setQueryData(['me'], ME);
  await renderUI(<SettingsPage page="learning" />, qc);
}

test('learning settings send the goal, rest days and retention preset to the server', async () => {
  const patch = jest.spyOn(api, 'PATCH').mockResolvedValue(ok(summary()) as never);
  await renderLearning();
  expect(screen.getByText(/lower your goal any time/)).toBeTruthy();

  await fireEvent.press(screen.getByText('20 min'));
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/v1/me/settings', { body: { daily_goal_min: 20 } }));
  await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());

  // Two rest days are already chosen: a third is refused kindly, without a request.
  await fireEvent.press(screen.getByTestId('rest-day-3'));
  expect(screen.getByTestId('rest-days-max')).toBeTruthy();
  expect(patch).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('rest-day-7'));
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/v1/me/settings', { body: { rest_days: [6] } }));
  await waitFor(() => expect(screen.getByTestId('rest-day-7').props.accessibilityState).toMatchObject({ checked: false }));

  expect(screen.getByTestId('retention-balanced').props.accessibilityState).toMatchObject({ checked: true });
  await fireEvent.press(screen.getByTestId('retention-thorough'));
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/v1/me/settings', { body: { desired_retention: 0.94 } }));
  // the choice shows once the server's answer is applied
  await waitFor(() => expect(screen.getByTestId('retention-thorough').props.accessibilityState).toMatchObject({ checked: true }));

  // Celebrations are this device's own.
  await fireEvent.press(screen.getByText('Calm'));
  expect(usePrefs.getState().celebrations).toBe('calm');
});

test('a failed settings change says so kindly and shows the server value again', async () => {
  jest.spyOn(api, 'PATCH').mockResolvedValue({ data: undefined, error: { type: 'about:blank', title: 'x', status: 500 }, response: { ok: false, status: 500, headers: new Headers() } } as never);
  await renderLearning();
  await fireEvent.press(screen.getByTestId('retention-relaxed'));
  await waitFor(() => expect(screen.getByText(/That didn't save, so nothing has changed/)).toBeTruthy());
  expect(screen.getByTestId('retention-balanced').props.accessibilityState).toMatchObject({ checked: true });
});

test('offline, learning settings stay as they are and say why', async () => {
  const patch = jest.spyOn(api, 'PATCH');
  useOnlineStore.setState({ serverReachable: false });
  await renderLearning();
  expect(screen.getByText(/Changing these needs a connection/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('retention-thorough'));
  expect(patch).not.toHaveBeenCalled();
});

// ------------------------------------------------------------------- the accessibility profile

/** The accessibility page, signed in, with /v1/me showing the account's settings. */
async function renderAccessibility(me: Learner = ME) {
  jest.spyOn(authSession, 'getStatus').mockReturnValue('signedIn');
  const qc = newQueryClient();
  qc.setQueryData(['me'], me);
  await renderUI(<SettingsPage page="accessibility" />, qc);
}

test('the accessibility switches change this device at once, and the account keeps a copy', async () => {
  const patch = jest.spyOn(api, 'PATCH').mockResolvedValue(ok(summary()) as never);
  await renderAccessibility();
  await fireEvent.press(screen.getByTestId('no-audio'));
  expect(usePrefs.getState().noAudio).toBe(true);
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/v1/me/settings', { body: { a11y_no_audio: true, a11y_no_vision: false } }));
  await fireEvent.press(screen.getByTestId('no-vision'));
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/v1/me/settings', { body: { a11y_no_audio: true, a11y_no_vision: true } }));
});

test('a copy the server does not take never stands in the way of the switch', async () => {
  const patch = jest.spyOn(api, 'PATCH').mockRejectedValue(new TypeError('Network request failed'));
  await renderAccessibility();
  await fireEvent.press(screen.getByTestId('no-audio'));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(usePrefs.getState().noAudio).toBe(true);
  expect(screen.getByTestId('no-audio').props.accessibilityState).toMatchObject({ checked: true });
});

test('a server whose settings keep no profile (an older one) is sent nothing by the switches', async () => {
  const patch = jest.spyOn(api, 'PATCH');
  const { a11y_no_audio: _a, a11y_no_vision: _v, ...older } = ME.settings;
  await renderAccessibility({ ...ME, settings: older as Learner['settings'] });
  await fireEvent.press(screen.getByTestId('no-audio'));
  expect(usePrefs.getState().noAudio).toBe(true);
  expect(patch).not.toHaveBeenCalled();
});

test("signed out, the switches are this device's alone", async () => {
  jest.spyOn(authSession, 'getStatus').mockReturnValue('signedOut');
  const patch = jest.spyOn(api, 'PATCH');
  await renderUI(<SettingsPage page="accessibility" />);
  await fireEvent.press(screen.getByTestId('no-vision'));
  expect(usePrefs.getState().noVision).toBe(true);
  expect(patch).not.toHaveBeenCalled();
});

test("at start-up, a different profile on the account is replaced by this device's, once", async () => {
  usePrefs.setState({ noAudio: true, noVision: false, hydrated: true });
  const patch = jest.spyOn(api, 'PATCH').mockResolvedValue(ok(summary()) as never);
  function Sync() {
    useA11yProfileSync();
    return null;
  }
  const qc = newQueryClient();
  qc.setQueryData(['me'], ME);
  await renderUI(<Sync />, qc);
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/v1/me/settings', { body: { a11y_no_audio: true, a11y_no_vision: false } }));
  // /v1/me answering again with the old copy (the change is still on its way) sends nothing more
  await act(async () => {
    qc.setQueryData(['me'], { ...ME, settings: { ...ME.settings } });
  });
  expect(patch).toHaveBeenCalledTimes(1);
  // and when the two agree nothing is sent at all
  patch.mockClear();
  usePrefs.setState({ noAudio: false });
  const agreeing = newQueryClient();
  agreeing.setQueryData(['me'], ME);
  await renderUI(<Sync />, agreeing);
  expect(patch).not.toHaveBeenCalled();
});

test('the start-up copy follows the learner: nothing is sent signed out, and the next learner on this device gets it too', async () => {
  usePrefs.setState({ noAudio: true, noVision: false, hydrated: true });
  const patch = jest.spyOn(api, 'PATCH').mockResolvedValue(ok(summary()) as never);
  function Sync(_: { run: number }) {
    useA11yProfileSync();
    return null;
  }
  const qc = newQueryClient();
  qc.setQueryData(['me'], ME);
  const view = await renderUI(<Sync run={0} />, qc);
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  // signed out: /v1/me is gone (useBootstrap removes it) and nothing is sent
  qc.removeQueries({ queryKey: ['me'] });
  await view.rerender(<Sync run={1} />);
  expect(patch).toHaveBeenCalledTimes(1);
  // someone else signs in on this device, their account holding another copy
  await act(async () => {
    qc.setQueryData(['me'], { ...ME, id: '00000000-0000-4000-8000-000000000002' });
  });
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
  expect(patch).toHaveBeenLastCalledWith('/v1/me/settings', { body: { a11y_no_audio: true, a11y_no_vision: false } });
});

test('answers played without sound reach the server after the copy that credits them', async () => {
  // switched on offline: the account has not heard of it, and a lesson's answers are waiting
  jest.spyOn(authSession, 'getStatus').mockReturnValue('signedIn');
  usePrefs.setState({ noAudio: true, noVision: false, hydrated: true });
  const learnerId = useLearner.getState().learnerId ?? '';
  await getOutbox(learnerId).enqueue({
    kind: 'review',
    client_uuid: 'a11y-first-1',
    created_at: '2026-10-08T09:00:00.000Z',
    monotonic_ms: 1,
    payload: { item_id: 'item.0000001', session_id: 'run-1', submission: { kind: 'choice', index: 1 }, rt_ms: 1200, hints_used: 0, plays_used: 0, started_at: '2026-10-08T08:59:58.000Z', content_version: 'sha256:x', local_verdict: 'correct', local_typo: false },
  });
  const order: string[] = [];
  jest.spyOn(api, 'PATCH').mockImplementation((async (path: string) => {
    order.push(path);
    return ok(summary());
  }) as never);
  const award = { badges: [], best_run: 0, gems: 0, goal: null, nodes_completed: [], quests_completed: [], sections_completed: [], streak: null, units_completed: [], xp: 0 };
  jest.spyOn(api, 'POST').mockImplementation((async (path: string) => {
    order.push(path);
    return ok({ results: [{ client_uuid: 'a11y-first-1', status: 'accepted' }], awards: award, due_now: 0 });
  }) as never);
  await expect(syncNow(learnerId)).resolves.toMatchObject({ state: 'sent', accepted: 1 });
  expect(order).toEqual(['/v1/me/settings', '/v1/sync/reviews']);
});

// ------------------------------------------------------------------- app themes

function Probe() {
  const theme = useTheme();
  return <Text testID="probe">{JSON.stringify({ accent: theme.accent, c: theme.c })}</Text>;
}

async function themeColours(accent: ThemeAccent | undefined, preference: 'light' | 'dark' = 'light') {
  const r = await render(
    <ThemeProvider preference={preference} face="nunito" reduceMotionPreference accent={accent}>
      <Probe />
    </ThemeProvider>,
  );
  const out = JSON.parse(String(screen.getByTestId('probe').props.children)) as { accent: string; c: Record<string, string> };
  await r.unmount();
  return out;
}

test.each([
  ['lagoon', 'light'],
  ['orange', 'light'],
  ['purple', 'dark'],
] as const)('a %s theme re-tints the primary role (%s), with its own on- colour', async (accent, mode) => {
  const base = colors[mode] as Record<string, string>;
  const { c } = await themeColours(accent, mode);
  expect(c.primary).toBe(base[accent]);
  expect(c['primary-lip']).toBe(base[`${accent}-lip`]);
  expect(c['primary-soft']).toBe(base[`${accent}-soft`]);
  expect(c['primary-ink']).toBe(base[`${accent}-ink`]);
  expect(c['on-primary']).toBe(base[`on-${accent}`]);
  // Semantic, level and focus colours never change.
  for (const k of ['success', 'danger', 'level-a1', 'blue', 'focus', 'ink', 'bg']) expect(c[k]).toBe(base[k]);
});

test('without a theme the primary role is the default blue', async () => {
  const { c, accent } = await themeColours(undefined);
  expect(accent).toBe('default');
  expect(c.primary).toBe(colors.light.primary);
  expect(c['on-primary']).toBe(colors.light['on-primary']);
});

test('the equipped shop theme sets the device accent, and back to default when none is used', async () => {
  const item = (id: string, equipped: boolean) => ({ id, kind: 'theme' as const, name: { en: id }, owned: true, equipped, price: 120 });
  const shop = (equipped: string | null): ShopOut => ({
    gems: 10,
    note: 'Gems buy looks only.',
    items: [item('theme.samarkand', equipped === 'theme.samarkand'), item('theme.chorsu', equipped === 'theme.chorsu'), item('theme.night_tashkent', equipped === 'theme.night_tashkent')],
  });
  expect(accentFromShop(undefined)).toBeNull();
  expect(accentFromShop(shop('theme.samarkand'))).toBe('lagoon');
  expect(accentFromShop(shop('theme.night_tashkent'))).toBe('purple');

  function Sync() {
    useCosmeticSync();
    return null;
  }
  const qc = newQueryClient();
  qc.setQueryData(['shop'], shop('theme.chorsu'));
  await renderUI(<Sync />, qc);
  expect(usePrefs.getState().accent).toBe('orange');
  await act(async () => {
    qc.setQueryData(['shop'], shop(null));
  });
  // the query cache notifies its observers on the next tick
  await waitFor(() => expect(usePrefs.getState().accent).toBe('default'));
});
