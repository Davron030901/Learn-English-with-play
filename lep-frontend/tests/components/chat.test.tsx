import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { api, session as authSession } from '@/api/client';
import { AI_TIMEOUT_MS } from '@/api/transport';
import type { AiStatusOut, CastOut, ConversationOut, SummaryOut, TurnOut } from '@/api/types';
import { CastShelf } from '@/features/chat/CastShelf';
import { ChatScreen } from '@/features/chat/ChatScreen';
import { EMPTY_LEARNER, useLearner } from '@/state/learner';
import { useOnlineStore } from '@/state/online';

import { newQueryClient, renderUI } from './render';

/**
 * The AI conversation partner (docs/16 E21): labelled an AI character, goals from the unit,
 * recasts underlined and explained on tap, a uniform daily ceiling, and an end card with two
 * things to work on and a delete button. The app only talks to our server.
 */

const UNIT = 'S01U01';
const ok = <T,>(data: T) => ({
  data,
  error: undefined,
  response: { ok: true, status: 200, headers: new Headers() } as Response,
});

const STATUS: AiStatusOut = {
  available: true,
  daily_limit: 5,
  used_today: 1,
  max_turns: 12,
  retention_days: 30,
};
const CAST: CastOut = {
  characters: [
    {
      id: 'sarah',
      name: 'Sarah',
      role: { en: 'English teacher, new in Tashkent' },
      first_unit: UNIT,
      ai: true,
    },
  ],
  scenarios: [
    {
      unit_id: UNIT,
      cefr: 'A1.1',
      title: { en: 'Hello' },
      can_do: ['I can greet people.', 'I can say my name.'],
      characters: ['sarah'],
    },
  ],
};
const CONVERSATION: ConversationOut = {
  id: 'c-1',
  character_id: 'sarah',
  unit_id: UNIT,
  mode: 'accuracy',
  opening_line: 'Hi! I am Sarah. What is your name?',
  subgoals: [
    { id: 'g1', text: 'Greet people' },
    { id: 'g2', text: 'Say my name' },
  ],
  starters: ['Hello!', 'My name is …'],
  max_turns: 12,
  expires_at: '2026-11-03T10:00:00Z',
};
const AWARDS = {
  xp: 3,
  gems: 0,
  goal_met_now: false,
  nodes_completed: [],
  units_completed: [],
  quests_completed: [],
  badges: [],
  streak_milestone: null,
} as unknown as TurnOut['awards'];
const TURN: TurnOut = {
  reply: 'Nice to meet you, Ali! My name is Sarah too.',
  recasts: [{ original: 'my name Ali', corrected: 'My name is', start: 23, end: 33 }],
  subgoals_met: ['g1'],
  turn: 1,
  max_turns: 12,
  ended: false,
  goal_met: false,
  off_limits: false,
  awards: AWARDS,
};
const SUMMARY: SummaryOut = {
  goal_met: false,
  subgoals_met: ['g1'],
  focus_items: [{ original: 'my name Ali', corrected: 'My name is Ali' }],
  words_used: ['hello', 'name'],
  xp: 3,
  turns: 1,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  useLearner.setState({
    learnerId: 'chat-learner',
    data: { ...EMPTY_LEARNER, profile: { l1: 'uz', spellingVariant: 'us' } },
    loaded: true,
  });
  useOnlineStore.setState({ network: true, serverReachable: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function seeded(status: AiStatusOut = STATUS) {
  const qc = newQueryClient();
  qc.setQueryData(['ai', 'status'], status);
  qc.setQueryData(['ai', 'cast', UNIT], CAST);
  return qc;
}

test('a chat: labelled AI, goals tick, a recast is underlined and explained, the end card offers delete', async () => {
  const post = jest.spyOn(api, 'POST').mockImplementation((async (path: string) => {
    if (path === '/v1/ai/conversations') return ok(CONVERSATION);
    if (path === '/v1/ai/conversations/{conversation_id}/turns') return ok(TURN);
    if (path === '/v1/ai/conversations/{conversation_id}/end') return ok(SUMMARY);
    throw new Error(`unexpected ${path}`);
  }) as never);
  const del = jest
    .spyOn(api, 'DELETE')
    .mockResolvedValue({
      data: undefined,
      error: undefined,
      response: { ok: true, status: 204, headers: new Headers() } as Response,
    } as never);
  const onBack = jest.fn();
  await renderUI(<ChatScreen characterId="sarah" unitId={UNIT} onBack={onBack} />, seeded());

  // the pre-chat card
  expect(screen.getByText('AI character, not a real person')).toBeTruthy();
  expect(screen.getByText('I can greet people.')).toBeTruthy();
  expect(screen.getByTestId('chat-allowance').props.children).toBe('Today: 1 of 5 conversations');
  await fireEvent.press(screen.getByTestId('chat-start'));
  await waitFor(() => expect(screen.getByTestId('chat-room')).toBeTruthy());
  expect(post).toHaveBeenCalledWith('/v1/ai/conversations', {
    body: {
      character_id: 'sarah',
      unit_id: UNIT,
      mode: 'accuracy',
      client_uuid: expect.stringMatching(/^[0-9a-f-]{36}$/),
    },
  });
  expect(screen.getByText('Hi! I am Sarah. What is your name?')).toBeTruthy();

  // Help offers the unit's phrases
  await fireEvent.press(screen.getByTestId('chat-help'));
  expect(screen.getByTestId('chat-starters')).toBeTruthy();

  // a turn
  await fireEvent.changeText(screen.getByTestId('chat-input'), 'hello, my name Ali');
  await fireEvent.press(screen.getByTestId('chat-send'));
  await waitFor(() => expect(screen.getByTestId('chat-turn').props.children).toBe('Turn 1 of 12'));
  const calls = post.mock.calls as unknown as [
    string,
    { body: { text: string; client_uuid: string } },
  ][];
  const call = calls.find(([p]) => p.endsWith('/turns')) as (typeof calls)[number];
  expect(call[1].body.text).toBe('hello, my name Ali');
  expect(call[1].body.client_uuid).toMatch(/^[0-9a-f-]{36}$/);
  expect(screen.getByTestId('chat-goal-g1').props.accessibilityState).toEqual({ checked: true });
  expect(screen.getByTestId('chat-goal-g2').props.accessibilityState).toEqual({ checked: false });
  // the state is in what a screen reader reads, and the speaker is labelled an AI in the room
  expect(screen.getByTestId('chat-goal-g1').props.accessible).toBe(true);
  expect(screen.getByTestId('chat-goal-g1').props.accessibilityLabel).toBe('Greet people: done');
  expect(screen.getByTestId('chat-goal-g2').props.accessibilityLabel).toBe('Say my name: not yet');
  expect(screen.getByTestId('chat-ai-label')).toBeTruthy();

  // the recast span is the corrected phrase; a tap explains it
  const recast = screen.getByTestId('chat-recast');
  expect(recast.props.children).toBe('My name is');
  expect(recast.props.accessibilityRole).toBe('link');
  await fireEvent.press(recast);
  expect(screen.getByTestId('chat-explain').props.children).toBe(
    'You said “my name Ali”. A more natural way: “My name is”.',
  );

  // the end card
  await fireEvent.press(screen.getByTestId('chat-end'));
  await waitFor(() => expect(screen.getByTestId('chat-summary')).toBeTruthy());
  expect(screen.getByTestId('chat-summary-title').props.children).toBe(
    'Good practice. The goal can wait for next time.',
  );
  expect(screen.getByText('My name is Ali')).toBeTruthy();
  expect(screen.getByText('+3 XP')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('chat-delete'));
  await waitFor(() => expect(onBack).toHaveBeenCalled());
  expect(del).toHaveBeenCalledWith('/v1/ai/conversations/{conversation_id}', {
    params: { path: { conversation_id: 'c-1' } },
  });
});

test("today's allowance is used: no start, and the speaking lessons are offered instead", async () => {
  const post = jest.spyOn(api, 'POST');
  await renderUI(
    <ChatScreen characterId="sarah" unitId={UNIT} onBack={jest.fn()} />,
    seeded({ ...STATUS, used_today: 5 }),
  );
  expect(screen.getByText("That's today's conversations")).toBeTruthy();
  await fireEvent.press(screen.getByTestId('chat-start'));
  expect(post).not.toHaveBeenCalled();
});

test('a turn that fails keeps its words and retries with the same id', async () => {
  let fail = true;
  const post = jest.spyOn(api, 'POST').mockImplementation((async (path: string) => {
    if (path === '/v1/ai/conversations') return ok(CONVERSATION);
    if (fail) {
      fail = false;
      return {
        data: undefined,
        error: { type: 'ai_unavailable', status: 503 },
        response: { ok: false, status: 503, headers: new Headers() } as Response,
      };
    }
    return ok(TURN);
  }) as never);
  await renderUI(<ChatScreen characterId="sarah" unitId={UNIT} onBack={jest.fn()} />, seeded());
  await fireEvent.press(screen.getByTestId('chat-start'));
  await waitFor(() => expect(screen.getByTestId('chat-room')).toBeTruthy());
  await fireEvent.changeText(screen.getByTestId('chat-input'), 'Hello Sarah');
  await fireEvent.press(screen.getByTestId('chat-send'));
  await waitFor(() => expect(screen.getByTestId('chat-retry')).toBeTruthy());
  expect(screen.getByText('Hello Sarah')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('chat-retry'));
  await waitFor(() => expect(screen.getByTestId('chat-turn').props.children).toBe('Turn 1 of 12'));
  const ids = (post.mock.calls as unknown as [string, { body: { client_uuid: string } }][])
    .filter(([p]) => p.endsWith('/turns'))
    .map(([, init]) => init.body.client_uuid);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});

const UNAVAILABLE = {
  data: undefined,
  error: { type: 'ai_unavailable', status: 503 },
  response: { ok: false, status: 503, headers: new Headers() } as Response,
};

async function started() {
  await fireEvent.press(screen.getByTestId('chat-start'));
  await waitFor(() => expect(screen.getByTestId('chat-room')).toBeTruthy());
}

async function say(text: string) {
  await fireEvent.changeText(screen.getByTestId('chat-input'), text);
  await fireEvent.press(screen.getByTestId('chat-send'));
}

test('an unsent message is tried again, with its own id, before anything new is said', async () => {
  // the server may still be answering it (a client timeout) or may have answered it already
  let turns = 0;
  const post = jest.spyOn(api, 'POST').mockImplementation((async (path: string) => {
    if (path === '/v1/ai/conversations') return ok(CONVERSATION);
    turns += 1;
    return turns === 1 ? UNAVAILABLE : ok(TURN);
  }) as never);
  await renderUI(<ChatScreen characterId="sarah" unitId={UNIT} onBack={jest.fn()} />, seeded());
  await started();
  await say('Hello Sarah');
  await waitFor(() => expect(screen.getByTestId('chat-retry')).toBeTruthy());
  await fireEvent.changeText(screen.getByTestId('chat-input'), 'My name is Ali');
  expect(
    screen.getByTestId('chat-send').props.accessibilityState?.disabled ??
      screen.getByTestId('chat-send').props.disabled,
  ).toBe(true);
  await fireEvent.press(screen.getByTestId('chat-send'));
  expect(turns).toBe(1);
  await fireEvent.press(screen.getByTestId('chat-retry'));
  await waitFor(() => expect(screen.getByTestId('chat-turn').props.children).toBe('Turn 1 of 12'));
  expect(screen.getByText('Hello Sarah')).toBeTruthy();
  const ids = (post.mock.calls as unknown as [string, { body: { client_uuid: string } }][])
    .filter(([p]) => p.endsWith('/turns'))
    .map(([, init]) => init.body.client_uuid);
  expect(ids).toEqual([ids[0], ids[0]]);
  // now the next message goes
  await fireEvent.press(screen.getByTestId('chat-send'));
  await waitFor(() => expect(turns).toBe(3));
});

test('a start that failed is retried with the same id, so the server charges it once', async () => {
  let starts = 0;
  const post = jest.spyOn(api, 'POST').mockImplementation((async (path: string) => {
    if (path !== '/v1/ai/conversations') throw new Error(`unexpected ${path}`);
    starts += 1;
    return starts === 1 ? UNAVAILABLE : ok(CONVERSATION);
  }) as never);
  await renderUI(<ChatScreen characterId="sarah" unitId={UNIT} onBack={jest.fn()} />, seeded());
  await fireEvent.press(screen.getByTestId('chat-start'));
  await waitFor(() => expect(starts).toBe(1));
  await fireEvent.press(screen.getByTestId('chat-start'));
  await waitFor(() => expect(screen.getByTestId('chat-room')).toBeTruthy());
  const ids = (post.mock.calls as unknown as [string, { body: { client_uuid: string } }][]).map(
    ([, init]) => init.body.client_uuid,
  );
  expect(ids).toHaveLength(2);
  expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(ids[1]).toBe(ids[0]);
});

test('End chat and Try again wait while a reply is being written', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const post = jest.spyOn(api, 'POST').mockImplementation((async (path: string) => {
    if (path === '/v1/ai/conversations') return ok(CONVERSATION);
    if (path === '/v1/ai/conversations/{conversation_id}/end') return ok(SUMMARY);
    await gate;
    return ok(TURN);
  }) as never);
  await renderUI(<ChatScreen characterId="sarah" unitId={UNIT} onBack={jest.fn()} />, seeded());
  await started();
  await say('Hello Sarah, my name is Ali');
  await waitFor(() => expect(screen.getByTestId('chat-typing')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('chat-end'));
  const ended = () =>
    (post.mock.calls as unknown as [string][]).filter(([p]) => p.endsWith('/end'));
  expect(ended()).toHaveLength(0);
  release();
  await waitFor(() => expect(screen.getByTestId('chat-turn').props.children).toBe('Turn 1 of 12'));
  await fireEvent.press(screen.getByTestId('chat-end'));
  await waitFor(() => expect(screen.getByTestId('chat-summary')).toBeTruthy());
  expect(ended()).toHaveLength(1);
});

test('meeting every goal offers the end card; the learner may keep chatting', async () => {
  const done: TurnOut = { ...TURN, subgoals_met: ['g1', 'g2'], goal_met: true };
  jest.spyOn(api, 'POST').mockImplementation((async (path: string) => {
    if (path === '/v1/ai/conversations') return ok(CONVERSATION);
    if (path === '/v1/ai/conversations/{conversation_id}/end')
      return ok({ ...SUMMARY, goal_met: true, subgoals_met: ['g1', 'g2'] });
    return ok(done);
  }) as never);
  await renderUI(<ChatScreen characterId="sarah" unitId={UNIT} onBack={jest.fn()} />, seeded());
  await started();
  await say('Hello! My name is Ali.');
  await waitFor(() => expect(screen.getByTestId('chat-goal-prompt')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('chat-goal-continue'));
  expect(screen.queryByTestId('chat-goal-prompt')).toBeNull();
  expect(screen.getByTestId('chat-input')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('chat-end'));
  await waitFor(() =>
    expect(screen.getByTestId('chat-summary-title').props.children).toBe('Goal reached'),
  );
  expect(screen.getByTestId('chat-summary-goal-g2').props.accessibilityLabel).toBe(
    'Say my name: done',
  );
});

test('the Library shelf is hidden entirely when the server has no model', async () => {
  const qc = newQueryClient();
  qc.setQueryData(['ai', 'status'], { ...STATUS, available: false });
  await renderUI(<CastShelf />, qc);
  expect(screen.queryByTestId('cast-shelf')).toBeNull();
});

test('starting a chat and sending a turn wait as long as the model may take; ending does not', async () => {
  const sent = jest
    .spyOn(authSession, 'fetchAuthed')
    .mockRejectedValue(new Error('not sent in this test'));
  const call = async (run: () => Promise<unknown>) => {
    await run().catch(() => undefined);
    return (sent.mock.calls.at(-1)?.[0] as { timeoutMs?: number }).timeoutMs;
  };
  expect(
    await call(() =>
      api.POST('/v1/ai/conversations', {
        body: { character_id: 'sarah', unit_id: UNIT, mode: 'accuracy' },
      }),
    ),
  ).toBe(AI_TIMEOUT_MS);
  expect(
    await call(() =>
      api.POST('/v1/ai/conversations/{conversation_id}/turns', {
        params: { path: { conversation_id: 'c-1' } },
        body: { client_uuid: '0193a000-0000-7000-8000-000000000000', text: 'Hello' },
      }),
    ),
  ).toBe(AI_TIMEOUT_MS);
  expect(
    await call(() =>
      api.POST('/v1/ai/conversations/{conversation_id}/end', {
        params: { path: { conversation_id: 'c-1' } },
      }),
    ),
  ).toBeUndefined();
});

test('a message the server refuses as invalid goes back into the input instead of blocking the chat', async () => {
  let turns = 0;
  jest.spyOn(api, 'POST').mockImplementation((async (path: string) => {
    if (path === '/v1/ai/conversations') return ok(CONVERSATION);
    turns += 1;
    return turns === 1
      ? {
          data: undefined,
          error: { type: 'validation_error', status: 422, errors: [] },
          response: { ok: false, status: 422, headers: new Headers() } as Response,
        }
      : ok(TURN);
  }) as never);
  await renderUI(<ChatScreen characterId="sarah" unitId={UNIT} onBack={jest.fn()} />, seeded());
  await started();
  await say('Hello Sarah');
  await waitFor(() => expect(screen.getByTestId('chat-input').props.value).toBe('Hello Sarah'));
  expect(screen.queryByTestId('chat-retry')).toBeNull();
  await fireEvent.press(screen.getByTestId('chat-send'));
  await waitFor(() => expect(screen.getByTestId('chat-turn').props.children).toBe('Turn 1 of 12'));
});

test('a word a correction brought in can be saved for practice from the end card', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { content } = require('@/content/queries') as typeof import('@/content/queries');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LexiconIndex } = require('@/content/repository') as typeof import('@/content/repository');
  jest.spyOn(content, 'loadLexicon').mockResolvedValue(
    new LexiconIndex([
      { id: 'lex.00010', w: 'love', u: 'S01U05' },
      { id: 'lex.00011', w: 'teacher', u: 'S01U02' },
    ]),
  );
  const summary: SummaryOut = {
    ...SUMMARY,
    focus_items: [{ original: 'I like my teacher', corrected: 'I love my teacher' }],
  };
  jest.spyOn(api, 'POST').mockImplementation((async (path: string) => {
    if (path === '/v1/ai/conversations') return ok(CONVERSATION);
    if (path === '/v1/ai/conversations/{conversation_id}/end') return ok(summary);
    return ok(TURN);
  }) as never);
  await renderUI(<ChatScreen characterId="sarah" unitId={UNIT} onBack={jest.fn()} />, seeded());
  await started();
  await say('I like my teacher');
  await waitFor(() => expect(screen.getByTestId('chat-turn').props.children).toBe('Turn 1 of 12'));
  await fireEvent.press(screen.getByTestId('chat-end'));
  await waitFor(() => expect(screen.getByTestId('chat-save-love')).toBeTruthy());
  expect(screen.queryByTestId('chat-save-teacher')).toBeNull();
  await fireEvent.press(screen.getByTestId('chat-save-love'));
  expect(useLearner.getState().data.savedWords.map((w) => w.lexemeId)).toEqual(['lex.00010']);
  expect(screen.getByTestId('chat-save-love').props.accessibilityLabel).toBe(
    '“love” is saved — tap to remove it',
  );
});
