import AsyncStorage from '@react-native-async-storage/async-storage';

import { publicApi } from '@/api/client';
import { flushClientEvents } from '@/features/clientEvents';
import { countEvent, readCounts } from '@/state/clientEvents';

/**
 * Events only the device can see (frontend DECISIONS §23): counted per device, sent as names and
 * counts only, taken off the counts only once the server accepted them.
 */

const accepted = (n: number) => ({ data: { accepted: n }, error: undefined, response: { ok: true, status: 202, headers: new Headers() } as Response });
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  await AsyncStorage.clear();
});
afterEach(() => jest.restoreAllMocks());

test('counts add up, even when they arrive together', async () => {
  for (let i = 0; i < 5; i++) countEvent('refresh_response_lost');
  countEvent('outbox_full');
  await settle();
  expect(await readCounts()).toEqual({ refresh_response_lost: 5, outbox_full: 1 });
});

test('a flush sends names and counts only, and takes off what was accepted', async () => {
  countEvent('audio_fallback');
  countEvent('audio_fallback');
  countEvent('server_plan_unplayable');
  await settle();
  const post = jest.spyOn(publicApi, 'POST').mockImplementation((async () => {
    countEvent('audio_fallback'); // counted while the request was in flight: kept for next time
    await settle();
    return accepted(3);
  }) as never);
  await flushClientEvents();
  expect(post).toHaveBeenCalledTimes(1);
  const [path, init] = post.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }];
  expect(path).toBe('/v1/client-events');
  expect(init.body).toEqual({
    platform: 'ios',
    app_version: '1.0.0',
    events: [
      { name: 'server_plan_unplayable', count: 1 },
      { name: 'audio_fallback', count: 2 },
    ],
  });
  expect(Object.keys(init.body).sort()).toEqual(['app_version', 'events', 'platform']);
  expect(await readCounts()).toEqual({ audio_fallback: 1 });
});

test('nothing to send sends nothing; a failure keeps the counts', async () => {
  const post = jest.spyOn(publicApi, 'POST');
  await flushClientEvents();
  expect(post).not.toHaveBeenCalled();

  countEvent('outbox_full');
  await settle();
  post.mockImplementation((async () => {
    throw new Error('offline');
  }) as never);
  await flushClientEvents();
  expect(await readCounts()).toEqual({ outbox_full: 1 });
  post.mockImplementation((async () => ({ data: undefined, error: { type: 'rate_limited' }, response: { ok: false, status: 429, headers: new Headers() } as Response })) as never);
  await flushClientEvents();
  expect(await readCounts()).toEqual({ outbox_full: 1 });
});
