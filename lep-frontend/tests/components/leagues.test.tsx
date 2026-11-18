import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { api, session } from '@/api/client';
import { queryClient } from '@/api/queryClient';
import { displayNameProblem } from '@/api/queries/leagues';
import type { Learner } from '@/api/session';
import type { LeagueStatusOut } from '@/api/types';
import { sfx } from '@/audio/sfx';
import { LeagueScreen } from '@/features/leagues/LeagueScreen';

import { renderUI } from './render';

jest.mock('@/audio/sfx', () => ({ sfx: jest.fn() }));

/**
 * Opt-in weekly leagues (docs/16 E23, docs/10 §6): off until the learner joins with a display
 * name, never for a learner who might be a minor, honest about the stress, no countdown, the
 * result shown once with no sad Pip, and leaving is one tap and a neutral confirmation.
 */

const ok = <T,>(data: T) => ({
  data,
  error: undefined,
  response: { ok: true, status: 200, headers: new Headers() } as Response,
});
const fail = (status: number, body: Record<string, unknown>) => ({
  data: undefined,
  error: { status, ...body },
  response: { ok: false, status, headers: new Headers() } as Response,
});

const WEEK = { week_starts_at: '2026-10-04T15:00:00Z', week_ends_at: '2026-10-11T15:00:00Z' };

function status(over: Partial<LeagueStatusOut> = {}): LeagueStatusOut {
  return { opted_in: false, eligible: true, tier: 1, league: null, result: null, ...WEEK, ...over };
}

function me(over: Partial<Learner> = {}): Learner {
  return {
    id: '0193d000-0000-7000-8000-000000000001',
    email: 'aziz@example.uz',
    l1: 'uz',
    birth_year: 1999,
    is_minor: false,
    tz: 'Asia/Tashkent',
    display_name: null,
    daily_goal_min: 10,
    status: 'active',
    created_at: '2026-09-01T00:00:00Z',
    settings: {
      desired_retention: 0.9,
      rest_days: [],
      leagues_opt_in: false,
      league_tier: 1,
      perfectionist_mode: false,
      data_collection_paused: false,
      spelling_variant: 'us',
    },
    ...over,
  } as Learner;
}

function table(): LeagueStatusOut['league'] {
  const rows = Array.from({ length: 14 }, (_, i) => ({
    rank: i + 1,
    display_name: i === 8 ? 'Aziz' : `Learner ${i + 1}`,
    weekly_xp: 300 - i * 10,
    you: i === 8,
    zone: (i < 7 ? 'up' : i >= 9 ? 'down' : null) as 'up' | 'down' | null,
  }));
  return { id: '0193d000-0000-7000-8000-0000000000aa', tier: 4, members: rows };
}

let current: LeagueStatusOut;
let learner: Learner;

beforeEach(() => {
  queryClient.clear();
  current = status();
  learner = me();
  jest.spyOn(session, 'getStatus').mockReturnValue('signedIn');
  jest
    .spyOn(api, 'GET')
    .mockImplementation((async (path: string) =>
      path === '/v1/me' ? ok(learner) : ok(current)) as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  queryClient.clear();
});

test('off by default: the explainer is honest, and joining needs a valid display name', async () => {
  const patch = jest.spyOn(api, 'PATCH').mockImplementation((async () => {
    current = status({ opted_in: true });
    learner = me({ display_name: 'Aziz' });
    return ok({});
  }) as never);
  await renderUI(<LeagueScreen onBack={jest.fn()} />, queryClient);
  await waitFor(() => expect(screen.getByTestId('leagues-explainer')).toBeTruthy());
  expect(screen.getByText(/some find it stressful\. You can leave any time\./)).toBeTruthy();
  expect(
    screen.getByText(/see your display name and your XP for the week, and nothing else/),
  ).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId('leagues-name'), 'aziz@example.uz');
  await fireEvent.press(screen.getByTestId('leagues-join'));
  expect(patch).not.toHaveBeenCalled();
  expect(screen.getByText(/Use letters, digits, spaces, _ or - only/)).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId('leagues-name'), 'Aziz');
  await fireEvent.press(screen.getByTestId('leagues-join'));
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith('/v1/me/settings', {
      body: { leagues_opt_in: true, display_name: 'Aziz' },
    }),
  );
  // joined: no group until the first lesson of the week
  await waitFor(() => expect(screen.getByTestId('leagues-no-group')).toBeTruthy());
  expect(screen.getByText('Clay League')).toBeTruthy();
});

test('a learner who might be a minor is told plainly, and offered nothing to join', async () => {
  current = status({ eligible: false });
  await renderUI(<LeagueScreen onBack={jest.fn()} />, queryClient);
  await waitFor(() => expect(screen.getByTestId('leagues-minor')).toBeTruthy());
  expect(screen.queryByTestId('leagues-join')).toBeNull();
  expect(screen.queryByTestId('leagues-table')).toBeNull();
});

test("the server's refusal is explained in the learner's language", async () => {
  jest
    .spyOn(api, 'PATCH')
    .mockImplementation((async () => fail(403, { type: 'leagues_not_for_minors' })) as never);
  await renderUI(<LeagueScreen onBack={jest.fn()} />, queryClient);
  await waitFor(() => expect(screen.getByTestId('leagues-name')).toBeTruthy());
  await fireEvent.changeText(screen.getByTestId('leagues-name'), 'Aziz');
  await fireEvent.press(screen.getByTestId('leagues-join'));
  await waitFor(() => expect(screen.getByText(/Leagues are for adults/)).toBeTruthy());
});

test('the table: places, the bands that move up and down, your own row, and no countdown', async () => {
  current = status({ opted_in: true, tier: 4, league: table() });
  learner = me({ display_name: 'Aziz' });
  await renderUI(<LeagueScreen onBack={jest.fn()} />, queryClient);
  await waitFor(() => expect(screen.getByTestId('leagues-table')).toBeTruthy());
  expect(screen.getByText('Silver League')).toBeTruthy();
  expect(screen.getByText(/^Week ends /)).toBeTruthy();
  expect(screen.queryByText(/left|hours|minutes/i)).toBeNull();
  expect(screen.getByText('Moves up')).toBeTruthy();
  expect(screen.getByText('Moves down')).toBeTruthy();
  expect(screen.getByTestId('leagues-your-place')).toHaveTextContent('Your place: 9 of 14');
  expect(screen.getByLabelText('Place 1: Learner 1, 300 XP, moves up')).toBeTruthy();
  expect(screen.getByLabelText('Place 9: Aziz (You), 220 XP')).toBeTruthy();
  expect(screen.getByLabelText('Place 14: Learner 14, 170 XP, moves down')).toBeTruthy();
  expect(screen.getByText('Only XP from scheduled work counts. Revision doesn’t.')).toBeTruthy();
});

test("last week's result is shown once, with a sound only for moving up", async () => {
  const post = jest.spyOn(api, 'POST').mockImplementation((async () => ({
    data: undefined,
    error: undefined,
    response: { ok: true, status: 204, headers: new Headers() } as Response,
  })) as never);
  current = status({
    opted_in: true,
    tier: 2,
    result: {
      ...WEEK,
      tier_before: 1,
      tier_after: 2,
      rank: 3,
      moved: 1,
      weekly_xp: 240,
      members: 27,
    },
  });
  await renderUI(<LeagueScreen onBack={jest.fn()} />, queryClient);
  await waitFor(() => expect(screen.getByTestId('leagues-result')).toBeTruthy());
  expect(screen.getByText('You moved up to Brick!')).toBeTruthy();
  expect(screen.getByText('Last week: place 3 of 27, 240 XP.')).toBeTruthy();
  expect(sfx).toHaveBeenCalledWith('promote');
  await fireEvent.press(screen.getByTestId('leagues-result-ok'));
  await waitFor(() => expect(screen.queryByTestId('leagues-result')).toBeNull());
  expect(post).toHaveBeenCalledWith('/v1/leagues/result-seen');
});

test('moving down is said as plainly as next week’s tier, without a sound', async () => {
  (sfx as jest.Mock).mockClear();
  current = status({
    opted_in: true,
    tier: 3,
    result: {
      ...WEEK,
      tier_before: 4,
      tier_after: 3,
      rank: 28,
      moved: -1,
      weekly_xp: 15,
      members: 30,
    },
  });
  await renderUI(<LeagueScreen onBack={jest.fn()} />, queryClient);
  await waitFor(() => expect(screen.getByText('Next week: Copper League.')).toBeTruthy());
  expect(sfx).not.toHaveBeenCalled();
});

test('leaving is one tap and a neutral confirmation that the tier is kept', async () => {
  const patch = jest.spyOn(api, 'PATCH').mockImplementation((async () => {
    current = status();
    return ok({});
  }) as never);
  current = status({ opted_in: true, tier: 4, league: table() });
  learner = me({ display_name: 'Aziz' });
  await renderUI(<LeagueScreen onBack={jest.fn()} />, queryClient);
  await waitFor(() => expect(screen.getByTestId('leagues-leave')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('leagues-leave'));
  expect(screen.getByText('Your tier is kept for 4 weeks.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('leagues-leave-yes'));
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith('/v1/me/settings', { body: { leagues_opt_in: false } }),
  );
  await waitFor(() => expect(screen.getByTestId('leagues-explainer')).toBeTruthy());
});

test('display names follow the server rules', () => {
  expect(displayNameProblem('  Aziz   K ')).toBeNull();
  expect(displayNameProblem('O\u02bbg\u02bbiloy')).toBeNull();
  expect(displayNameProblem('\u0414\u0438\u043b\u043d\u043e\u0437\u0430')).toBeNull();
  expect(displayNameProblem('a')).toBe('length');
  expect(displayNameProblem('x'.repeat(25))).toBe('length');
  expect(displayNameProblem('me@example.com')).toBe('characters');
  expect(displayNameProblem('site.com')).toBe('characters');
  expect(displayNameProblem('12345')).toBe('characters');
  expect(displayNameProblem('zero\u200bwidth')).toBe('characters');
});
