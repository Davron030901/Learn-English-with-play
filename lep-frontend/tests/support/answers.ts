import type { Item, NormaliseRule } from '@/content/schemas';
import { joinTiles, type Submission } from '@/grading/grade';
import { normaliseReadings } from '@/grading/normalise';

/**
 * Builds the submissions a real learner could make, for the corpus sweep (brief §16.1).
 * The two harness traps the brief warns about are handled explicitly: tiles are keyed by index
 * (a bank can hold the same surface twice) and a wrong answer is *verified* wrong against the
 * key — never assumed wrong because it was reversed or shuffled.
 */

const rulesOf = (item: Item): Set<NormaliseRule> =>
  new Set('normalise' in item.answer ? (item.answer as { normalise: NormaliseRule[] }).normalise : []);

function sameText(a: string, b: string, rules: Set<NormaliseRule>): boolean {
  const ra = normaliseReadings(a, rules);
  const rb = normaliseReadings(b, rules);
  return ra.some((x) => rb.includes(x));
}

/** A tile order whose join spells the key: depth-first over unused tiles. */
export function tilesForKey(bank: readonly string[], key: string, caseInsensitive: boolean): number[] | null {
  const norm = (s: string) => (caseInsensitive ? s.toLowerCase() : s);
  const target = norm(key);
  const used = new Array<boolean>(bank.length).fill(false);
  const order: number[] = [];
  const dfs = (): boolean => {
    const text = norm(joinTiles(order.map((i) => bank[i] ?? '')));
    if (text === target) return true;
    if (!target.startsWith(text)) return false;
    for (let i = 0; i < bank.length; i += 1) {
      if (used[i]) continue;
      used[i] = true;
      order.push(i);
      if (dfs()) return true;
      order.pop();
      used[i] = false;
    }
    return false;
  };
  return dfs() ? [...order] : null;
}

export function correctSubmission(item: Item): Submission | null {
  switch (item.type_id) {
    case 'mcq_word_from_definition':
    case 'pragmatics_choose':
    case 'minimal_pair_discrimination':
    case 'grammaticality_judgement':
    case 'stress_tap':
    case 'phoneme_id':
    case 'odd_one_out':
    case 'read_scan_detail':
    case 'read_gist_mcq':
    case 'listen_gist_mcq':
    case 'listen_detail_gap':
      return { kind: 'choice', index: item.answer.index };
    case 'gap_fill_bank': {
      const rules = rulesOf(item);
      const hit = item.prompt.bank.find((w) => item.answer.key.some((k) => sameText(w, k, rules)));
      return hit === undefined ? null : { kind: 'text', text: hit };
    }
    case 'type_from_l1':
    case 'dictation_word':
    case 'error_correct':
    case 'dictation_sentence':
    case 'spelling_bee':
    case 'gap_fill_free':
    case 'write_sentence':
      return { kind: 'text', text: item.answer.key[0] ?? 'I like it.' };
    case 'word_bank_build':
    case 'sentence_reorder': {
      const key = item.answer.key[0] ?? '';
      const tiles = tilesForKey(item.prompt.bank, key, rulesOf(item).has('case'));
      return tiles ? { kind: 'tiles', indices: tiles } : null;
    }
    case 'listen_order_events': {
      const used = new Set<number>();
      const indices: number[] = [];
      for (const line of item.answer.key) {
        const i = item.prompt.options.findIndex((o, j) => o === line && !used.has(j));
        if (i < 0) return null;
        used.add(i);
        indices.push(i);
      }
      return { kind: 'order', indices };
    }
    case 'tap_pairs':
    case 'memory_match':
    case 'word_race':
      return {
        kind: 'pairs',
        matches: item.prompt.pairs.map((_, i) => [i, i] as [number, number]),
        mistakes: 0,
        complete: true,
      };
    case 'sort_bins': {
      const assignment: Record<number, number> = {};
      item.prompt.options.forEach((w, i) => {
        assignment[i] = item.prompt.bins.indexOf(item.answer.mapping[w] ?? '');
      });
      return { kind: 'bins', assignment };
    }
    case 'repeat_after':
    case 'read_aloud':
    case 'speak_prompt':
    case 'speak_roleplay':
    case 'speak_retell':
      return item.answer.key.length > 0
        ? { kind: 'speech', modality: 'typed', text: item.answer.key[0] ?? '' }
        : { kind: 'speech', modality: 'voice' };
  }
}

/**
 * A wrong submission, verified wrong against the key; null when the item offers no way to be
 * wrong (content defect C7: a single option).
 */
export function wrongSubmission(item: Item, otherKeys: readonly string[]): Submission | null {
  switch (item.type_id) {
    case 'mcq_word_from_definition':
    case 'pragmatics_choose':
    case 'minimal_pair_discrimination':
    case 'grammaticality_judgement':
    case 'phoneme_id':
    case 'odd_one_out':
    case 'read_scan_detail':
    case 'read_gist_mcq':
    case 'listen_gist_mcq':
    case 'listen_detail_gap': {
      const n = item.prompt.options.length;
      if (n < 2) return null;
      return { kind: 'choice', index: (item.answer.index + 1) % n };
    }
    case 'stress_tap': {
      const n = item.prompt.syllables.length;
      if (n < 2) return null;
      return { kind: 'choice', index: (item.answer.index + 1) % n };
    }
    case 'gap_fill_bank': {
      const rules = rulesOf(item);
      const miss = item.prompt.bank.find((w) => !item.answer.key.some((k) => sameText(w, k, rules)));
      return miss === undefined ? null : { kind: 'text', text: miss };
    }
    case 'type_from_l1':
    case 'dictation_word':
    case 'error_correct':
    case 'dictation_sentence':
    case 'spelling_bee':
    case 'gap_fill_free': {
      const rules = rulesOf(item);
      const accepted = [...item.answer.key, ...(item.answer.accepted ?? [])];
      const candidates = item.type_id === 'error_correct' ? [item.prompt.text, ...otherKeys] : otherKeys;
      const wrong = candidates.find((c) => c.trim() && !accepted.some((a) => sameText(c, a, rules)));
      return wrong === undefined ? null : { kind: 'text', text: wrong };
    }
    case 'write_sentence':
      return null;
    case 'word_bank_build':
    case 'sentence_reorder': {
      const right = correctSubmission(item);
      if (!right || right.kind !== 'tiles') return null;
      const key = item.answer.key[0] ?? '';
      const rules = rulesOf(item);
      const bank = item.prompt.bank;
      // Try every adjacent swap; keep the first that is verified wrong.
      for (let i = 0; i + 1 < right.indices.length; i += 1) {
        const swapped = [...right.indices];
        [swapped[i], swapped[i + 1]] = [swapped[i + 1] as number, swapped[i] as number];
        const text = joinTiles(swapped.map((j) => bank[j] ?? ''));
        if (!sameText(text, key, rules)) return { kind: 'tiles', indices: swapped };
      }
      return null;
    }
    case 'listen_order_events': {
      const right = correctSubmission(item);
      if (!right || right.kind !== 'order') return null;
      for (let i = 0; i + 1 < right.indices.length; i += 1) {
        const a = right.indices[i] as number;
        const b = right.indices[i + 1] as number;
        if (item.prompt.options[a] !== item.prompt.options[b]) {
          const swapped = [...right.indices];
          swapped[i] = b;
          swapped[i + 1] = a;
          return { kind: 'order', indices: swapped };
        }
      }
      return null;
    }
    case 'tap_pairs':
    case 'memory_match':
    case 'word_race': {
      const pairs = item.prompt.pairs;
      if (pairs.length < 2) return null;
      // Rotate the right-hand side by one: each left meets another pair's gloss.
      const matches = pairs.map((_, i) => [i, (i + 1) % pairs.length] as [number, number]);
      const allWrong = matches.every(([l, r]) => item.answer.mapping[pairs[l]?.[0] ?? ''] !== pairs[r]?.[1]);
      return allWrong ? { kind: 'pairs', matches, mistakes: pairs.length, complete: true } : null;
    }
    case 'sort_bins': {
      const right = correctSubmission(item);
      if (!right || right.kind !== 'bins' || item.prompt.bins.length < 2) return null;
      const assignment = { ...right.assignment };
      const first = assignment[0] ?? 0;
      assignment[0] = (first + 1) % item.prompt.bins.length;
      return { kind: 'bins', assignment };
    }
    case 'speak_prompt':
    case 'speak_roleplay':
    case 'speak_retell':
      // Fluency tasks: a typed answer that matches nothing is sent for marking, never failed here.
      return null;
    case 'repeat_after':
    case 'read_aloud': {
      if (item.answer.key.length === 0) return null;
      const rules = new Set<NormaliseRule>(['contraction', 'case', 'punct', 'spacing', 'spelling_variant']);
      const wrong = otherKeys.find((c) => c.trim() && !item.answer.key.some((k) => sameText(c, k, rules)));
      return wrong === undefined ? null : { kind: 'speech', modality: 'typed', text: wrong };
    }
  }
}
