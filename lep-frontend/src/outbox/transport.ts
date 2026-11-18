import { api } from '@/api/client';
import { ApiError, problemFromBody } from '@/api/problem';
import type { AwardsOut } from '@/api/types';

import type { OutboxRecord } from './outbox';
import { serverSupportsSync, type SyncTransport } from './sync';

/**
 * POST /v1/sync/reviews (backend brief §11). The server is idempotent on `client_uuid`: a row it
 * has seen before comes back `duplicate`, which is acknowledged like `accepted`. A row it refuses
 * (an item this content version no longer has, a malformed answer) stays on the device, visible in
 * Settings. Awards — XP, the goal, the streak, quests, stamps — are handed to `onAwards`.
 */
export function apiSyncTransport(onAwards: (awards: AwardsOut, dueNow: number) => void): SyncTransport {
  return {
    async send(batch: readonly OutboxRecord[]) {
      const records = batch.map((r) => ({
        kind: r.kind,
        client_uuid: r.client_uuid,
        created_at: r.created_at,
        monotonic_ms: Math.max(0, Math.round(r.monotonic_ms)),
        payload: r.payload,
      }));
      const { data, error, response } = await api.POST('/v1/sync/reviews', {
        // The payload shapes are the outbox's own; the server validates them.
        body: { records } as never,
      });
      if (!response.ok || !data) throw new ApiError(problemFromBody(error, response, null));
      onAwards(data.awards, data.due_now);
      const requestId = response.headers.get('x-request-id');
      return {
        accepted: data.results.filter((r) => r.status !== 'rejected').map((r) => r.client_uuid),
        rejected: data.results
          .filter((r) => r.status === 'rejected')
          .map((r) => ({ client_uuid: r.client_uuid, type: r.problem ?? 'rejected', request_id: requestId })),
      };
    },
  };
}

/** The transport when the server offers sync, else null (answers wait on the device). */
export function transportFor(onAwards: (awards: AwardsOut, dueNow: number) => void): SyncTransport | null {
  return serverSupportsSync() ? apiSyncTransport(onAwards) : null;
}
