import { syncNow } from '@/outbox/syncer';

/**
 * Offers the outbox until it is empty or the server cannot be reached (a few rounds at most):
 * an assessment is graded from what the server stored, so its answers must be in first.
 */
export async function flushOutbox(learnerId: string): Promise<boolean> {
  for (let round = 0; round < 4; round++) {
    const outcome = await syncNow(learnerId);
    if (outcome.state === 'nothing_to_send') return true;
    if (outcome.state === 'failed' || outcome.state === 'waiting_for_server') return false;
  }
  return true;
}
