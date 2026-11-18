import { readJson, writeJson } from './storage';

/**
 * Events only the device can see (frontend DECISIONS F2, §23; backend DECISIONS §14.6), counted
 * here until the server can be told. A fixed list, a count each — no learner, no device id, no
 * text — kept per device (not per learner), so signing out does not lose them and they never
 * say whose they were.
 */
export const CLIENT_EVENTS = [
  'refresh_response_lost',
  'outbox_full',
  'server_plan_unplayable',
  'audio_fallback',
] as const;
export type ClientEventName = (typeof CLIENT_EVENTS)[number];
export type EventCounts = Partial<Record<ClientEventName, number>>;

const KEY = 'lep:device:client-events';
/** Counts per name stop growing here: a stuck loop must not grow the store for ever. */
const CAP = 1_000;

let chain: Promise<unknown> = Promise.resolve();

/** Serialises every read-modify-write of the counts. */
function locked<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run.catch(() => undefined);
  return run;
}

export function countEvent(name: ClientEventName): void {
  void locked(async () => {
    const counts = await readJson<EventCounts>(KEY, {});
    counts[name] = Math.min(CAP, (counts[name] ?? 0) + 1);
    await writeJson(KEY, counts);
  }).catch(() => {
    // a lost count is a lost count; it never gets in the learner's way
  });
}

export function readCounts(): Promise<EventCounts> {
  return locked(() => readJson<EventCounts>(KEY, {}));
}

/** Takes away what the server accepted, keeping anything counted since it was read. */
export function subtractCounts(sent: EventCounts): Promise<void> {
  return locked(async () => {
    const counts = await readJson<EventCounts>(KEY, {});
    for (const name of CLIENT_EVENTS) {
      const left = (counts[name] ?? 0) - (sent[name] ?? 0);
      if (left > 0) counts[name] = left;
      else delete counts[name];
    }
    await writeJson(KEY, counts);
  });
}
