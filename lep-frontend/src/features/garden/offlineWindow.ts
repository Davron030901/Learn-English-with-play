import { api, unwrap } from '@/api/client';
import { serverOperations } from '@/api/paths.generated';
import { contentVersion } from '@/content/version.generated';
import { readJson, writeJson } from '@/state/storage';

import type { SavedWindow } from './dueWindow';

export type { SavedDue, SavedWindow } from './dueWindow';
export { dueFromWindow } from './dueWindow';

/**
 * The reviews due in the next seven days, as the server last said (GET /v1/sync/bundle), kept on
 * this device so the garden can be watered offline (docs/00 §6: offline holds all due SRS items).
 *
 * Nothing here schedules. The server chose every due date and every exercise; offline, the
 * device only plays those whose time has come. The answers go to the outbox like any lesson's,
 * and the server re-derives every memory state from them when it hears of them — so a review
 * played offline is never a guess, at most one more review than the server would have asked.
 */

export const serverHasSyncBundle = (serverOperations as readonly string[]).includes('GET /v1/sync/bundle');

/** Under `lep:learner:`, so signing out clears it with the rest of the learner's device data. */
const keyFor = (learnerId: string) => `lep:learner:${learnerId}:due-window`;

/** Ask the server for the window and keep it; null when this server has no such endpoint. */
export async function refreshDueWindow(learnerId: string): Promise<SavedWindow | null> {
  if (!serverHasSyncBundle) return null;
  const bundle = unwrap(await api.GET('/v1/sync/bundle', { params: { query: { since: contentVersion } } }));
  const saved: SavedWindow = {
    asOf: bundle.as_of,
    contentVersion: bundle.content_version,
    due: bundle.due.flatMap((d) => (d.item_id ? [{ memoryItemId: d.memory_item_id, itemId: d.item_id, dueAt: d.due_at }] : [])),
  };
  await writeJson(keyFor(learnerId), saved);
  return saved;
}

export function loadDueWindow(learnerId: string): Promise<SavedWindow | null> {
  return readJson<SavedWindow | null>(keyFor(learnerId), null);
}
