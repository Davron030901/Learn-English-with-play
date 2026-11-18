import { seeded } from '@/runner/compose';

/**
 * docs/09 §4.1 / DECISIONS S22: option position is randomised per presentation (a seeded
 * shuffle), and the renderer maps the shown position back to the canonical index before grading
 * and before anything is sent. stress_tap syllables are never shuffled.
 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A permutation of 0…n-1: `order[shown] = canonical`. */
export function presentationOrder(n: number, itemId: string, seed: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  const rand = seeded(hash(itemId) ^ seed);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return order;
}
