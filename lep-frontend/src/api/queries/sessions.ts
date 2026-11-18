import { serverOperations } from '../paths.generated';
import { api, unwrap } from '../client';
import { ApiError } from '../problem';
import type { SessionOut } from '../types';
import type { AccessibilityProfile } from '@/a11y/profile';
import { log } from '@/lib/log';

/**
 * Server-composed sessions (POST /v1/sessions, docs/08 §5). The server's scheduler decides what
 * a session holds and enforces the tier gates (tier 3 opens 3 days after tier 2) and the daily
 * cap on new material; the app asks, and falls back to composing on the device only when the
 * server cannot be asked (offline, an error, an older server).
 *
 * The request names this device's accessibility profile (DECISIONS F19): the server then chooses
 * exercise types the learner can be shown, leaves out lesson items it has no form for (`withheld`)
 * and passes the node-tier on the rest.
 */

export const serverHasSessions = (serverOperations as readonly string[]).includes(
  'POST /v1/sessions',
);

export type NodeSessionResult =
  | { kind: 'plan'; plan: SessionOut }
  /** tier 3 is spaced: it opens at `availableAt` */
  | { kind: 'spaced'; availableAt: string }
  /** the server has no record of the previous tier yet (it may still be in this device's outbox) */
  | { kind: 'previous_tier' }
  /** enough new material today */
  | { kind: 'capped' }
  /** the server could not be asked: compose on the device */
  | { kind: 'unavailable'; error: unknown };

export async function requestNodeSession(
  nodeId: string,
  tier: 1 | 2 | 3,
  minutes: number,
  profile: AccessibilityProfile,
): Promise<NodeSessionResult> {
  try {
    const plan = unwrap(
      await api.POST('/v1/sessions', {
        body: {
          minutes: Math.max(1, Math.min(60, Math.round(minutes))),
          node_id: nodeId,
          tier,
          a11y_profile: { no_audio: profile.noAudio, no_vision: profile.noVision },
        },
      }),
    );
    return { kind: 'plan', plan };
  } catch (e) {
    if (e instanceof ApiError && e.problem.status === 409) {
      if (e.problem.type === 'new_items_capped') return { kind: 'capped' };
      if (e.problem.type === 'tier_locked') {
        const at = e.problem.availableAt;
        return at ? { kind: 'spaced', availableAt: at } : { kind: 'previous_tier' };
      }
    }
    log.info('session.server_unavailable', {
      nodeId,
      tier,
      type: e instanceof ApiError ? e.problem.type : 'network',
    });
    return { kind: 'unavailable', error: e };
  }
}

/** Closes a server session; idempotent on the server, and never in the learner's way. */
export function completeServerSession(sessionId: string): void {
  void api
    .POST('/v1/sessions/{session_id}/complete', { params: { path: { session_id: sessionId } } })
    .catch((e: unknown) => log.info('session.complete_failed', { e }));
}
