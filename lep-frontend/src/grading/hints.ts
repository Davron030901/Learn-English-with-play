import type { Item } from '@/content/schemas';

/**
 * Hints (DECISIONS F18). 2,163 items allow one (`constraints.hints_allowed` ≥ 1) and none
 * carries hint text, so a hint is *derived from the item* — never written by the client:
 *   * type_from_l1 — the first letter of the key;
 *   * error_correct — where the prompt and the key differ.
 * Any other type with hints allowed gets no hint button rather than an invented hint.
 * A hint costs the no-hint tier and grades the review Hard (BACKEND-DECISIONS R12); the button
 * says so before it is tapped.
 */
export type Hint =
  | { kind: 'first_letter'; letter: string }
  | { kind: 'look_at'; span: string }
  | { kind: 'missing_after'; word: string }
  | { kind: 'missing_before'; word: string };

export function hintsAllowed(item: Item): number {
  return item.constraints.hints_allowed ?? 0;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

export function deriveHint(item: Item): Hint | null {
  if (hintsAllowed(item) < 1) return null;
  if (item.type_id === 'type_from_l1') {
    const key = item.answer.key[0]?.trim();
    const letter = key ? [...key][0] : undefined;
    return letter ? { kind: 'first_letter', letter } : null;
  }
  if (item.type_id === 'error_correct') {
    const key = item.answer.key[0];
    if (!key) return null;
    const p = words(item.prompt.text);
    const k = words(key);
    let start = 0;
    while (start < p.length && start < k.length && bare(p[start] ?? '') === bare(k[start] ?? '')) start += 1;
    let endP = p.length - 1;
    let endK = k.length - 1;
    while (endP >= start && endK >= start && bare(p[endP] ?? '') === bare(k[endK] ?? '')) {
      endP -= 1;
      endK -= 1;
    }
    if (endP >= start) return { kind: 'look_at', span: p.slice(start, endP + 1).join(' ') };
    // Nothing to change in the prompt: something is missing.
    if (start > 0) return { kind: 'missing_after', word: p[start - 1] ?? '' };
    if (p[0]) return { kind: 'missing_before', word: p[0] };
    return null;
  }
  return null;
}
