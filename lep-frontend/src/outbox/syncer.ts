import { a11yCopyFirst } from '@/api/queries/gamification';
import { invalidateProgress } from '@/api/queryClient';
import { log } from '@/lib/log';
import { useAwards } from '@/state/awards';
import { usePrefs } from '@/state/prefs';

import { getOutbox } from './index';
import { syncOutbox, type SyncOutcome } from './sync';
import { transportFor } from './transport';

/**
 * When the outbox is offered to the server: right after a lesson closes (`syncNow`), shortly
 * after any answer is stored (`scheduleSync`, debounced), on reconnect and when the app returns
 * to the foreground. One sync runs at a time per learner; a request that arrives while one runs
 * is folded into one more run after it, so nothing waits for the next trigger.
 */
const running = new Map<string, Promise<SyncOutcome>>();
const again = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

async function runOnce(learnerId: string): Promise<SyncOutcome> {
  const transport = transportFor((awards) => {
    useAwards.getState().push(awards);
  });
  const outbox = getOutbox(learnerId);
  // The account's accessibility profile goes ahead of the answers it credits (DECISIONS §21);
  // before the switches have loaded there is nothing to go on.
  const prefs = usePrefs.getState();
  if (transport && prefs.hydrated && (await outbox.size()) > 0) {
    await a11yCopyFirst(learnerId, { noAudio: prefs.noAudio, noVision: prefs.noVision });
  }
  const outcome = await syncOutbox(outbox, transport);
  if (outcome.state === 'sent') invalidateProgress();
  log.info('outbox.sync', outcome);
  return outcome;
}

export function syncNow(learnerId: string): Promise<SyncOutcome> {
  const current = running.get(learnerId);
  if (current) {
    again.add(learnerId);
    return current;
  }
  const p = runOnce(learnerId)
    .catch((e: unknown): SyncOutcome => {
      log.info('outbox.sync_error', e);
      return { state: 'failed', pending: 0 };
    })
    .finally(() => {
      running.delete(learnerId);
      if (again.delete(learnerId)) void syncNow(learnerId);
    });
  running.set(learnerId, p);
  return p;
}

/** Debounced: many answers in a row become one request. */
export function scheduleSync(learnerId: string, delayMs = 2_000): void {
  const t = timers.get(learnerId);
  if (t) clearTimeout(t);
  timers.set(
    learnerId,
    setTimeout(() => {
      timers.delete(learnerId);
      void syncNow(learnerId);
    }, delayMs),
  );
}
