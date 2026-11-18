import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import type { AwardsOut, GamificationSummary, ProgressOut, QuestOut, SessionSummary, ShopOut } from '@/api/types';
import PathScreen from '@/app/(tabs)/index';
import { DEFAULT_PROFILE } from '@/a11y/profile';
import type { Course, Unit } from '@/content/model';
import { ContentRepository } from '@/content/repository';
import type { Item } from '@/content/schemas';
import { CelebrationHost } from '@/features/celebrate/CelebrationHost';
import { useCelebrations } from '@/features/celebrate/queue';
import { HudBar } from '@/features/hud/HudBar';
import { StreakSheet, TodaySheet } from '@/features/hud/HudSheets';
import { earnedState, lessonEarned, type LessonEarned } from '@/features/hud/sessionAwards';
import { LessonEndView } from '@/features/lesson/Interstitials';
import { LessonRunner } from '@/features/lesson/LessonRunner';
import { RunChip } from '@/features/lesson/RunChip';
import { mergeTiers, serverPathOf } from '@/features/path/merge';
import { QuestsCard } from '@/features/quests/QuestsCard';
import { composeNodeSession } from '@/runner/compose';
import { useAwards } from '@/state/awards';
import { EMPTY_LEARNER, useLearner } from '@/state/learner';

import { fsContentSource } from '../support/fsSource';
import { answer } from './drive';
import { newQueryClient, renderUI } from './render';

/**
 * The motivation layer on the learner's screens (docs/16 E00–E14): every number shown comes from
 * the server (or says it is not available), the lesson-end summary is honest offline, rare
 * celebrations land their stamps and are reported seen, the run chip rises at five in a row, and
 * the path offers the free test-out on units that are not done.
 */

const mockMarkSeen = jest.fn();
const mockAcknowledge = jest.fn();
jest.mock('@/api/queries/gamification', () => ({
  ...jest.requireActual<object>('@/api/queries/gamification'),
  useMarkBadgesSeen: () => ({ mutate: mockMarkSeen }),
  useAcknowledgeReset: () => ({ mutate: mockAcknowledge }),
}));

const repo = new ContentRepository(fsContentSource);
let course: Course;
let unit: Unit;
let words: ReadonlySet<string>;
let n = 0;

beforeAll(async () => {
  [course, unit, words] = await Promise.all([repo.loadCourse(), repo.loadUnit('S01U01'), repo.loadWords()]);
});

beforeEach(async () => {
  await AsyncStorage.clear();
  n += 1;
  useLearner.setState({ learnerId: `learner-e${n}`, data: { ...EMPTY_LEARNER, profile: { l1: 'uz', spellingVariant: 'us' } }, loaded: true });
  useCelebrations.getState().reset();
  useAwards.getState().clear();
  mockMarkSeen.mockClear();
  mockAcknowledge.mockClear();
  jest.mocked(router.push).mockClear();
});

// ---------------------------------------------------------------- fixtures (server shapes)

const quest = (id: string, progress: number, target: number, completed = false, period: 'day' | 'week' = 'day'): QuestOut => ({
  id,
  metric: 'answers',
  period,
  progress,
  target,
  completed,
  completed_now: false,
  gems: 15,
  title: { en: `Answer ${target} questions`, uz: `${target} ta savolga javob bering`, ru: `Ответьте на ${target} вопросов` },
});

function summaryOf(over: Partial<GamificationSummary> = {}): GamificationSummary {
  return {
    as_of: '2026-10-04T09:30:00Z',
    today: '2026-10-04',
    gems: 340,
    xp_today: 45,
    xp_week: 210,
    xp_total: 1800,
    goal: { goal_min: 10, minutes_today: 6.4, met: false, met_now: false },
    streak: { current: 12, longest: 20, freezes: 2, can_repair: false, milestone_now: null, paused_until: null, reset_message: null, rest_days: [], today_counted: true },
    daily_quests: [quest('q-day-1', 4, 10), quest('q-day-2', 1, 1, true), quest('q-day-3', 0, 3)],
    weekly_quests: [quest('q-week-1', 20, 60, false, 'week')],
    unseen_badges: [],
    ...over,
  };
}

function awardsOf(over: Partial<AwardsOut> = {}): AwardsOut {
  return {
    xp: 0,
    gems: 0,
    best_run: 0,
    goal: null,
    streak: null,
    quests_completed: [],
    nodes_completed: [],
    units_completed: [],
    sections_completed: [],
    badges: [],
    ...over,
  };
}

const LEARNED = { lexemes: [], grammar: [] };

function endView(earned: LessonEarned, before: GamificationSummary | null = null) {
  const onStop = jest.fn();
  return {
    onStop,
    ui: (
      <LessonEndView
        earned={earned}
        practised={9}
        minutes={6}
        introduced={LEARNED}
        nextTitle={null}
        withheld={0}
        withheldByProfile={0}
        notSaved={false}
        onStop={onStop}
        onNext={null}
        before={before}
        nodeTitle={(id) => (id === 'S01U01N2' ? 'Hello and goodbye' : null)}
        unitNumber={() => 1}
      />
    ),
  };
}

// ---------------------------------------------------------------- the lesson-end summary (E04)

test('the lesson-end summary shows what the server awarded: XP, the ring, the streak, quests and tiers', async () => {
  const before = summaryOf({ goal: { goal_min: 10, minutes_today: 4, met: false, met_now: false }, streak: { ...summaryOf().streak, current: 11, today_counted: false } });
  const after = summaryOf({ goal: { goal_min: 10, minutes_today: 10.2, met: true, met_now: true }, streak: { ...summaryOf().streak, current: 12, today_counted: true } });
  const session: SessionSummary = { session_id: 'run-1', xp: 24, answers: 9, correct: 7, graded: 8, nodes_completed: [{ node_id: 'S01U01N2', tier: 1 }] };
  const earned = lessonEarned({ state: 'online', awards: [awardsOf({ xp: 24, gems: 10 })], before, after, session });
  expect(earned.goal).toMatchObject({ before: 4, after: 10.2, met: true, metNow: true });
  expect(earned.streak).toEqual({ current: 12, todayCounted: true, creditedNow: true });

  const { ui, onStop } = endView(earned, before);
  await renderUI(ui);

  expect(screen.getByTestId('tile-xp').props.accessibilityLabel).toBe('24 XP earned in this lesson');
  expect(screen.getByTestId('lesson-end-xp')).toHaveTextContent('24');
  expect(screen.getByTestId('lesson-end-breakdown')).toHaveTextContent(/From 9 answers in this lesson/);
  expect(screen.getByTestId('lesson-end-goal').props.accessibilityLabel).toBe('Daily goal: 10 of 10 minutes');
  expect(screen.getByTestId('lesson-end-goal-met')).toHaveTextContent("Goal done. That's a good place to stop.");
  expect(screen.getByTestId('lesson-end-streak').props.accessibilityLabel).toBe('Streak: 12 days. Today counts towards your streak.');
  expect(screen.getByTestId('quest-q-day-1')).toBeTruthy();
  expect(screen.getByText('Hello and goodbye · tier 1 done')).toBeTruthy();
  expect(screen.getByText('+10 gems')).toBeTruthy();
  expect(screen.queryByTestId('lesson-end-offline')).toBeNull();

  // Stopping stays the primary action; nothing moves on by itself.
  await fireEvent.press(screen.getByTestId('close-stop'));
  expect(onStop).toHaveBeenCalledTimes(1);
});

test('offline, the summary says the answers will count later and shows no invented number', async () => {
  expect(earnedState('slow', true)).toBe('offline');
  expect(earnedState('failed', true)).toBe('offline');
  expect(earnedState('syncing', true)).toBe('pending');
  expect(earnedState('sent', false)).toBe('unavailable');

  const before = summaryOf();
  const earned = lessonEarned({ state: 'offline', awards: [awardsOf({ xp: 30 })], before, after: null, session: null });
  expect(earned.xp).toBeNull();

  const { ui } = endView(earned, before);
  await renderUI(ui);

  expect(screen.getByTestId('lesson-end-offline')).toHaveTextContent("Your answers are saved and will count when you're back online.");
  expect(screen.getByTestId('lesson-end-xp-later')).toHaveTextContent("Counts when you're online");
  expect(screen.queryByTestId('lesson-end-xp')).toBeNull();
  expect(screen.queryByTestId('lesson-end-goal')).toBeNull();
  expect(screen.queryByTestId('lesson-end-streak')).toBeNull();
  // The minutes measured here are a fact, drawn as "waiting", never added to the server's ring.
  expect(screen.getByTestId('lesson-end-goal-waiting').props.accessibilityLabel).toBe('6 min waiting to sync');
});

// ---------------------------------------------------------------- celebrations (E11, E12)

test('a unit celebration lands its stamps and reports them seen once closed', async () => {
  const client = newQueryClient();
  client.setQueryData(['content', 'course'], course);
  useAwards.getState().push(
    awardsOf({
      xp: 12,
      units_completed: ['S01U01'],
      badges: [
        { id: 'b1', unit_id: 'S01U01', text: 'I can greet people and say goodbye.', awarded_at: '2026-10-04T09:30:00Z' },
        { id: 'b2', unit_id: 'S01U01', text: 'I can say my name and spell it.', awarded_at: '2026-10-04T09:30:00Z' },
      ],
    }),
  );
  await renderUI(<CelebrationHost active />, client);

  expect(screen.getByTestId('celebration-unit')).toBeTruthy();
  expect(screen.getByTestId('celebration-title')).toHaveTextContent('Unit 1 complete');
  expect(screen.getByTestId('stamp-0').props.accessibilityLabel).toBe('Stamp: I can greet people and say goodbye.');
  expect(screen.getByTestId('stamp-1')).toBeTruthy();
  // Calm by default under reduced motion: no confetti for a unit.
  expect(screen.queryByTestId('confetti')).toBeNull();

  await fireEvent.press(screen.getByTestId('celebration-continue'));
  expect(mockMarkSeen).toHaveBeenCalledTimes(1);
  expect(mockMarkSeen.mock.calls[0]?.[0]).toEqual(['b1', 'b2']);
  expect(screen.queryByTestId('celebration-unit')).toBeNull();
});

test('stamps the server still lists as unseen are shown once, and only while the host is active', async () => {
  const client = newQueryClient();
  client.setQueryData(['content', 'course'], course);
  client.setQueryData(['gamification', 'summary'], summaryOf({ unseen_badges: [{ id: 'b9', unit_id: 'S01U02', text: 'I can count to twenty.', awarded_at: '2026-10-03T18:00:00Z' }] }));
  const view = await renderUI(<CelebrationHost active={false} includeUnseen />, client);
  expect(screen.queryByTestId('celebration-stamps')).toBeNull();

  await view.rerender(<CelebrationHost active includeUnseen />);
  expect(screen.getByTestId('celebration-stamps')).toBeTruthy();
  expect(screen.getByTestId('celebration-title')).toHaveTextContent('Stamps earned');
  await fireEvent.press(screen.getByTestId('celebration-continue'));
  expect(mockMarkSeen).toHaveBeenCalledWith(['b9'], expect.anything());
  // Shown once: the same unseen list does not bring it back.
  expect(screen.queryByTestId('celebration-stamps')).toBeNull();
});

// ---------------------------------------------------------------- the HUD (E02, E03, E17)

test('the HUD shows the server numbers with spoken labels, and quiet dashes without them', async () => {
  const onStreak = jest.fn();
  const onGoal = jest.fn();
  const view = await renderUI(<HudBar title="Your path" level="A1" summary={summaryOf()} onStreak={onStreak} onGoal={onGoal} />);

  const streak = screen.getByTestId('hud-streak');
  expect(streak.props.accessibilityLabel).toBe('Streak: 12 days, today counts');
  expect(within(streak).getByText('12')).toBeTruthy();
  expect(screen.getByTestId('hud-gems').props.accessibilityLabel).toBe('340 gems');
  // The server keeps tenths; the ring speaks whole minutes.
  expect(screen.getByTestId('hud-goal').props.accessibilityLabel).toBe('Daily goal: 6 of 10 minutes');
  // XP stays off the bar (docs/16 E01): it is in the Today sheet.
  expect(screen.queryByText(/XP/)).toBeNull();
  await fireEvent.press(streak);
  await fireEvent.press(screen.getByTestId('hud-goal'));
  expect(onStreak).toHaveBeenCalledTimes(1);
  expect(onGoal).toHaveBeenCalledTimes(1);

  await view.rerender(<HudBar title="Your path" level="A1" summary={null} onStreak={onStreak} onGoal={onGoal} />);
  expect(screen.getByTestId('hud-streak').props.accessibilityLabel).toBe('Streak: not available yet');
  expect(within(screen.getByTestId('hud-streak')).getByText('–')).toBeTruthy();
  expect(screen.queryByTestId('hud-gems')).toBeNull();
  expect(screen.getByTestId('hud-goal').props.accessibilityLabel).toBe('Daily goal: not available yet');
});

test("the HUD sheets: today's XP, the goal and quests; the streak's free freezes; an offline snapshot says when", async () => {
  const s = summaryOf();
  const view = await renderUI(<TodaySheet summary={s} stale={false} onClose={jest.fn()} />);
  expect(screen.getByTestId('today-xp')).toHaveTextContent('45 XP today');
  expect(screen.getByTestId('today-week')).toHaveTextContent('210 XP this week');
  expect(screen.getByText('6 / 10 min')).toBeTruthy();
  expect(screen.getByTestId('quest-q-day-1').props.accessibilityLabel).toBe('Answer 10 questions: 4 of 10. Reward: 15 gems.');
  expect(screen.getByTestId('quest-q-day-2').props.accessibilityLabel).toBe('Answer 1 questions: done. Reward: 15 gems.');
  expect(screen.queryByTestId('hud-as-of')).toBeNull();

  await view.rerender(<StreakSheet summary={s} stale onClose={jest.fn()} />);
  expect(screen.getByTestId('streak-freezes')).toHaveTextContent("2 of 2 freezes ready. They're free and used automatically.");
  expect(screen.getByTestId('hud-as-of')).toHaveTextContent(/^As of /);
});

test("today's quests: collapsed to the day's dots, opened to the rows; without the server, no quest is invented", async () => {
  const s = summaryOf();
  const view = await renderUI(<QuestsCard daily={s.daily_quests} weekly={s.weekly_quests} available />);
  expect(screen.getByTestId('quests-toggle').props.accessibilityLabel).toBe("Today's quests, 1 of 3 done");
  await fireEvent.press(screen.getByTestId('quests-toggle'));
  expect(screen.getByTestId('quest-q-day-3')).toBeTruthy();
  expect(screen.getByTestId('quest-q-week-1')).toBeTruthy();

  await view.rerender(<QuestsCard daily={[]} weekly={[]} available={false} />);
  expect(screen.getByTestId('quests-body')).toHaveTextContent('Quests appear here once your account can show them.');
  expect(screen.queryByTestId(/^quest-q/)).toBeNull();
});

// ---------------------------------------------------------------- the run (E05)

test('the run chip rises at five right answers in a row, never before, and Pip cheers with it', async () => {
  const session = composeNodeSession(unit, 'S01U01N2', 1, { profile: DEFAULT_PROFILE, completed: new Map(), seed: 3 });
  const items = session.steps.flatMap((s) => (s.kind === 'item' ? [s.item] : []));
  await renderUI(<LessonRunner session={session} units={new Map([[unit.id, unit]])} words={words} course={course} onLeave={jest.fn()} onNext={jest.fn()} />);

  const seen: { after: number; label: string; pip: boolean }[] = [];
  const answered: Item[] = [];
  for (let guard = 0; guard < 300 && !screen.queryByTestId('close'); guard += 1) {
    if (screen.queryByTestId('feedback-continue')) {
      const chip = screen.queryByTestId('run-chip');
      if (chip) seen.push({ after: answered.length, label: String(chip.props.accessibilityLabel), pip: !!screen.queryByTestId('lesson-pip-cheer', { includeHiddenElements: true }) });
      await fireEvent.press(screen.getByTestId('feedback-continue'));
      continue;
    }
    if (screen.queryByTestId('got-it')) {
      await fireEvent.press(screen.getByTestId('got-it'));
      continue;
    }
    const shown = screen.queryAllByTestId(/^exercise-/)[0];
    if (!shown) throw new Error('nothing to do on screen');
    const type = String(shown.props.testID).replace('exercise-', '');
    const item = items.find((i) => i.type_id === type && !answered.includes(i)) ?? answered.find((a) => a.type_id === type);
    if (!item || !(await answer(item))) throw new Error(`no driver for ${type}`);
    answered.push(item);
  }
  expect(screen.getByTestId('close')).toBeTruthy();
  expect(answered.length).toBeGreaterThanOrEqual(5);
  expect(seen.length).toBeGreaterThanOrEqual(1);
  expect(seen[0]).toEqual({ after: expect.any(Number), label: '5 correct in a row', pip: true });
  expect(seen[0]?.after).toBeGreaterThanOrEqual(5);
});

test('the run chip itself: shown with its spoken count, hidden when not asked for', async () => {
  const view = await renderUI(<RunChip count={10} show />);
  expect(screen.getByTestId('run-chip').props.accessibilityLabel).toBe('10 correct in a row');
  expect(screen.getByText('10 in a row')).toBeTruthy();
  await view.rerender(<RunChip count={0} show={false} />);
  expect(screen.queryByTestId('run-chip')).toBeNull();
});

// ---------------------------------------------------------------- the path (E08, E14, E17)

function progressOf(): ProgressOut {
  const u1 = course.unitsById.get('S01U01');
  const tiers1 = Object.fromEntries((u1?.nodes ?? []).filter((x) => x.populatedTiers.length).map((x) => [x.id, Math.max(...x.populatedTiers)]));
  return {
    badges: [],
    coverage: { audited: false, estimate_percent: 1, known_lexemes: 20, learning_lexemes: 10, method: 'srs', total_lexemes: 6000 },
    current_unit: 'S01U02',
    level: { cefr: 'A1', percent: 2, units_done: 1, units_total: 168 },
    units: [
      { unit_id: 'S01U01', completed: true, tiers: tiers1 },
      { unit_id: 'S01U02', completed: false, tiers: { S01U02N1: 1 } },
    ],
  };
}

const SHOP: ShopOut = {
  gems: 340,
  note: 'Gems buy looks only.',
  items: [
    { id: 'outfit.doppi', kind: 'pip_outfit', name: { en: 'Doppi' }, owned: true, equipped: true, price: 300 },
    { id: 'path.silk_road', kind: 'path_skin', name: { en: 'Silk Road' }, owned: true, equipped: true, price: 800 },
  ],
};

test("the server's progress and this device's ticks merge; a tier counts when either says so", () => {
  const server = serverPathOf(progressOf());
  expect(server?.doneUnits.has('S01U01')).toBe(true);
  expect(server?.currentUnit).toBe('S01U02');
  const merged = mergeTiers(course, new Map([['S01U02N2', [1]]]), server);
  expect(merged.get('S01U02N1')).toEqual([1]);
  expect(merged.get('S01U02N2')).toEqual([1]);
  expect(mergeTiers(course, new Map([['S01U02N2', [1]]]), null).get('S01U02N1')).toBeUndefined();
});

test('the path: the HUD from the summary, the reset notice once, the current unit, and Test out on units not done', async () => {
  const client = newQueryClient();
  client.setQueryData(['content', 'course'], course);
  client.setQueryData(['progress'], progressOf());
  client.setQueryData(['shop'], SHOP);
  client.setQueryData(
    ['gamification', 'summary'],
    summaryOf({ streak: { ...summaryOf().streak, current: 0, today_counted: false, reset_message: "Your streak reset. That's fine — 41 days of learning didn't disappear." } }),
  );
  await renderUI(<PathScreen />, client);

  expect(screen.getByTestId('hud-gems').props.accessibilityLabel).toBe('340 gems');
  expect(screen.getByTestId('hud-goal').props.accessibilityLabel).toBe('Daily goal: 6 of 10 minutes');
  expect(screen.getByTestId('reset-notice')).toBeTruthy();
  expect(mockAcknowledge).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('reset-ok'));
  expect(screen.queryByTestId('reset-notice')).toBeNull();

  // The section's place band; the finished unit wears its trophy and has no test-out.
  expect(screen.getByTestId('band-S01')).toBeTruthy();
  expect(screen.getByTestId('banner-S01U01-status')).toHaveTextContent('Unit complete');
  expect(screen.queryByTestId('testout-S01U01')).toBeNull();

  // The current unit (from the server) is highlighted, and the Continue button goes there.
  expect(screen.getByTestId('banner-S01U02-status')).toHaveTextContent('You are here');
  expect(screen.getByTestId('continue')).toHaveTextContent(/^Continue · /);
  const first = course.unitsById.get('S01U02')?.nodes[0];
  expect(screen.getByTestId('node-S01U02N1').props.accessibilityLabel).toMatch(new RegExp(`1 of ${first?.populatedTiers.length} tiers finished\\.$`));
  expect(screen.getByText(/Ticks combine what your account has recorded/)).toBeTruthy();

  const testOut = screen.getByTestId('testout-S01U02');
  expect(testOut.props.accessibilityLabel).toMatch(/^Test out of Unit 2: .+\. Free, as often as you like\.$/);
  await fireEvent.press(testOut);
  expect(router.push).toHaveBeenCalledWith({ pathname: '/test-out/[unitId]', params: { unitId: 'S01U02' } });
});

test('without the server the path stays calm: quiet HUD, device ticks labelled as such, no invented numbers', async () => {
  const client = newQueryClient();
  client.setQueryData(['content', 'course'], course);
  useLearner.setState((s) => ({ data: { ...s.data, completed: { S01U01N1: { 1: '2026-10-04T08:00:00Z' } } } }));
  await renderUI(<PathScreen />, client);

  expect(screen.getByTestId('hud-streak').props.accessibilityLabel).toBe('Streak: not available yet');
  expect(screen.queryByTestId('hud-gems')).toBeNull();
  expect(screen.queryByTestId('reset-notice')).toBeNull();
  expect(screen.getByText('Ticks show what you finished on this device.')).toBeTruthy();
  expect(screen.getByTestId('node-S01U01N1').props.accessibilityLabel).toMatch(/finished on this device\.$/);
  expect(screen.getByTestId('banner-S01U01-status')).toHaveTextContent('You are here');
});
