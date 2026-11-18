import { serverOperations } from '@/api/paths.generated';
import { log } from '@/lib/log';

import type { Outbox, OutboxRecord } from './outbox';

/**
 * Replaying the outbox (brief §11). The server operations this needs — backend brief §11/§12's
 * `POST /v1/sync/reviews` and `POST /v1/reviews/{id}/dispute` — are not in the running server's
 * OpenAPI document yet (Phase 1 of the backend ships auth only). Until `npm run gen:api` picks
 * them up, `transportFor` returns null and every answer simply waits on the device: nothing is
 * sent to an endpoint that does not exist, and no path is hand-written in the meantime.
 */

export interface SyncTransport {
  /** Sends one batch; resolves with what the server accepted and what it refused. */
  send(batch: readonly OutboxRecord[]): Promise<{
    accepted: string[];
    rejected: { client_uuid: string; type: string; request_id: string | null }[];
  }>;
}

export const REQUIRED_OPERATIONS = ['POST /v1/sync/reviews'] as const;

export function serverSupportsSync(ops: readonly string[] = serverOperations): boolean {
  return REQUIRED_OPERATIONS.every((op) => ops.includes(op));
}

export type SyncOutcome =
  | { state: 'nothing_to_send' }
  | { state: 'waiting_for_server'; pending: number }
  | { state: 'sent'; accepted: number; rejected: number }
  | { state: 'failed'; pending: number };

const BATCH = 100;

export async function syncOutbox(outbox: Outbox, transport: SyncTransport | null): Promise<SyncOutcome> {
  if (!transport) {
    // Count, never read every row: with no endpoint there is nothing to send them to.
    const pending = await outbox.size();
    return pending === 0 ? { state: 'nothing_to_send' } : { state: 'waiting_for_server', pending };
  }
  const rows = (await outbox.list()).filter((r) => r.status === 'pending');
  if (rows.length === 0) return { state: 'nothing_to_send' };
  // Timestamp order: the server replays facts in the order they happened.
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.monotonic_ms - b.monotonic_ms);
  let accepted = 0;
  let rejected = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      const res = await transport.send(batch);
      await outbox.acknowledge(res.accepted);
      if (res.rejected.length) await outbox.markRejected(res.rejected);
      accepted += res.accepted.length;
      rejected += res.rejected.length;
    } catch (e) {
      log.info('outbox.sync_failed', e);
      return { state: 'failed', pending: rows.length - accepted - rejected };
    }
  }
  return { state: 'sent', accepted, rejected };
}
