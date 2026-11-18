import type { ComposedSession } from './compose';

/**
 * Sessions composed outside the lesson route (Practice) are handed over here by id. Memory only:
 * a reload loses them, and the lesson route then says it cannot find the session.
 */
const pending = new Map<string, ComposedSession>();

export function handOver(session: ComposedSession): string {
  pending.set(session.id, session);
  return session.id;
}

export function takeOver(id: string): ComposedSession | undefined {
  return pending.get(id);
}
