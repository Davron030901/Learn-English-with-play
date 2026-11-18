import type { Item, NormaliseRule, TypeId } from '@/content/schemas';

import { withinOneEdit } from './distance';
import { baseNormalise, normaliseReadings } from './normalise';
import { lexicalAlternatives } from './usUk';

/**
 * The optimistic grader (brief §5.7). It shows the learner a verdict in well under 100 ms; the
 * server's verdict, when there is a server that grades, is the one that is stored and shown.
 * It never grades authoritatively and never grades what it cannot: free speech and free writing
 * come back `ungraded`.
 */

export type Family = 'choice' | 'text' | 'bank' | 'order' | 'pairs' | 'bins' | 'speak';

export type Submission =
  /** Canonical option index (the renderer maps shuffled positions back before grading). */
  | { kind: 'choice'; index: number }
  /** Typed text; also the chosen word of `gap_fill_bank`. */
  | { kind: 'text'; text: string }
  /** Bank tiles by index into `prompt.bank`, in the order chosen. */
  | { kind: 'tiles'; indices: number[] }
  /** `listen_order_events`: indices into `prompt.options`, in the order chosen. */
  | { kind: 'order'; indices: number[] }
  /**
   * Pairs: every match made, as [leftIndex, rightIndex] into `prompt.pairs`. `attempts` holds
   * every try, wrong ones included (which pairs were confused); `timedOut` marks a game whose clock
   * ran out — the matches made so far still count (docs/09 #68, #69).
   */
  | { kind: 'pairs'; matches: [number, number][]; mistakes: number; complete: boolean; attempts?: [number, number][]; timedOut?: boolean }
  /** `sort_bins`: option index → bin index. */
  | { kind: 'bins'; assignment: Readonly<Record<number, number>> }
  /** Speaking: a recording (never graded here) or the typed fallback. */
  | { kind: 'speech'; modality: 'voice' | 'typed'; text?: string }
  /** The item's clock ran out (docs/09 §6: grade = Again, never a skip). */
  | { kind: 'timeout' };

export type Verdict = 'correct' | 'incorrect' | 'ungraded';

export interface GradeResult {
  verdict: Verdict;
  /** What the learner should see as the right answer, when there is one. */
  expected: string | null;
  /** Accepted with a spelling slip (docs/09 §5 rule 7: "watch the spelling"). */
  typo: { typed: string; expected: string } | null;
  /** The `rejected_with_feedback` row the answer matched (error_correct). */
  rejected: { errorCode: string; feedback: string } | null;
  /** Why an answer was not graded, or was graded Again without being wrong on its merits. */
  reason: 'timeout' | 'free_response' | 'voice' | null;
  /** Per-element result for pairs and bins, so the renderer can mark each one. */
  elements?: boolean[];
}

export interface GradeContext {
  /** The course's own English words — the real-word exclusion of rule 7. */
  words: ReadonlySet<string>;
  /** Lemmas of the lexemes the item targets (lexical US/UK pairs apply only to these). */
  targetLemmas?: readonly string[];
  /** Ranked exponents of the functions the item targets (speak_prompt accepts any of them). */
  functionExponents?: readonly string[];
}

export const FAMILY: Record<TypeId, Family> = {
  mcq_word_from_definition: 'choice',
  pragmatics_choose: 'choice',
  minimal_pair_discrimination: 'choice',
  grammaticality_judgement: 'choice',
  gap_fill_bank: 'choice',
  stress_tap: 'choice',
  phoneme_id: 'choice',
  odd_one_out: 'choice',
  read_scan_detail: 'choice',
  read_gist_mcq: 'choice',
  listen_gist_mcq: 'choice',
  listen_detail_gap: 'choice',
  type_from_l1: 'text',
  dictation_word: 'text',
  error_correct: 'text',
  dictation_sentence: 'text',
  spelling_bee: 'text',
  gap_fill_free: 'text',
  write_sentence: 'text',
  word_bank_build: 'bank',
  sentence_reorder: 'bank',
  listen_order_events: 'order',
  tap_pairs: 'pairs',
  memory_match: 'pairs',
  word_race: 'pairs',
  sort_bins: 'bins',
  repeat_after: 'speak',
  speak_prompt: 'speak',
  read_aloud: 'speak',
  speak_roleplay: 'speak',
  speak_retell: 'speak',
};

/** Rules for a typed answer to a speaking item, which carries no `normalise[]` of its own. */
const TYPED_SPEECH_RULES: readonly NormaliseRule[] = ['contraction', 'case', 'punct', 'spacing', 'spelling_variant'];

const result = (verdict: Verdict, expected: string | null, extra: Partial<GradeResult> = {}): GradeResult => ({
  verdict,
  expected,
  typo: null,
  rejected: null,
  reason: null,
  ...extra,
});

/** Joins bank tiles as written text: punctuation tiles attach to the word before them. */
export function joinTiles(tiles: readonly string[]): string {
  let out = '';
  for (const t of tiles) {
    if (out === '' || /^[.,!?;:)\]'’]/.test(t) || /^n't$/i.test(t)) out += t;
    else out += ` ${t}`;
  }
  return out;
}

/** True when the item can be graded on the device at all (brief §5.7 item 5). */
export function gradableOffline(item: Item): boolean {
  if (item.type_id === 'write_sentence' || item.type_id === 'speak_roleplay' || item.type_id === 'speak_retell') return false;
  if (item.type_id === 'speak_prompt') return item.answer.key.length > 0;
  return true;
}

export function expectedAnswer(item: Item): string | null {
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
    case 'listen_detail_gap':
      return item.prompt.options[item.answer.index] ?? null;
    case 'stress_tap':
      return item.prompt.syllables[item.answer.index] ?? null;
    case 'gap_fill_bank':
    case 'type_from_l1':
    case 'dictation_word':
    case 'error_correct':
    case 'dictation_sentence':
    case 'spelling_bee':
    case 'gap_fill_free':
    case 'write_sentence':
    case 'word_bank_build':
    case 'sentence_reorder':
    case 'repeat_after':
    case 'speak_prompt':
    case 'read_aloud':
    case 'speak_roleplay':
    case 'speak_retell':
      return item.answer.key[0] ?? null;
    case 'listen_order_events':
      return item.answer.key.join(' / ');
    case 'tap_pairs':
    case 'memory_match':
    case 'word_race':
    case 'sort_bins':
      return null;
  }
}

interface TextMatch {
  ok: boolean;
  typo: { typed: string; expected: string } | null;
}

/**
 * Compares a typed answer with every accepted form under the item's rules, then — only if
 * nothing matched and the item allows it — with typo tolerance (rule 7): exactly one word may
 * differ, by one Damerau–Levenshtein edit, the intended word must have 4+ characters, the typed
 * word must not itself be an English word (form/from, quiet/quite are the error), and never in
 * spelling_bee.
 */
export function matchText(
  typedRaw: string,
  accepted: readonly string[],
  rules: ReadonlySet<NormaliseRule>,
  ctx: GradeContext,
  allowTypo: boolean,
): TextMatch {
  const typedReadings = normaliseReadings(typedRaw, rules);
  const acceptedReadings = accepted.flatMap((a) => normaliseReadings(a, rules));
  for (const t of typedReadings) {
    if (t.length > 0 && acceptedReadings.includes(t)) return { ok: true, typo: null };
  }
  if (!allowTypo) return { ok: false, typo: null };
  for (const t of typedReadings) {
    const tw = t.split(' ');
    for (const a of acceptedReadings) {
      const aw = a.split(' ');
      if (tw.length !== aw.length) continue;
      let diff = -1;
      let tooMany = false;
      for (let i = 0; i < tw.length; i += 1) {
        if (tw[i] !== aw[i]) {
          if (diff >= 0) {
            tooMany = true;
            break;
          }
          diff = i;
        }
      }
      if (tooMany || diff < 0) continue;
      const typedWord = stripEdges(tw[diff] ?? '');
      const keyWord = stripEdges(aw[diff] ?? '');
      if (keyWord.length < 4) continue;
      if (!withinOneEdit(typedWord.toLowerCase(), keyWord.toLowerCase())) continue;
      if (ctx.words.has(typedWord.toLowerCase())) continue;
      return { ok: true, typo: { typed: typedWord, expected: keyWord } };
    }
  }
  return { ok: false, typo: null };
}

function stripEdges(w: string): string {
  return w.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
}

function acceptedForms(item: Item & { answer: { key: string[]; accepted?: string[] } }, ctx: GradeContext): string[] {
  const base = [...item.answer.key, ...(item.answer.accepted ?? [])];
  const lemmas = ctx.targetLemmas ?? [];
  const rules = 'normalise' in item.answer ? item.answer.normalise : [];
  if (!lemmas.length || !(rules as readonly string[]).includes('spelling_variant')) return base;
  return [...base, ...base.flatMap((k) => lexicalAlternatives(k, lemmas))];
}

export function grade(item: Item, sub: Submission, ctx: GradeContext): GradeResult {
  const expected = expectedAnswer(item);
  if (sub.kind === 'timeout') return result('incorrect', expected, { reason: 'timeout' });

  switch (item.type_id) {
    // ------------------------------------------------------------ choice (index)
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
    case 'listen_detail_gap': {
      if (sub.kind !== 'choice') throw new Error(`${item.type_id} needs a choice`);
      return result(sub.index === item.answer.index ? 'correct' : 'incorrect', expected);
    }

    // ------------------------------------------------------------ gap_fill_bank: a choice graded as text
    case 'gap_fill_bank': {
      if (sub.kind !== 'text') throw new Error('gap_fill_bank needs the chosen word as text');
      const m = matchText(sub.text, acceptedForms(item, ctx), new Set(item.answer.normalise), ctx, false);
      return result(m.ok ? 'correct' : 'incorrect', expected);
    }

    // ------------------------------------------------------------ text
    case 'type_from_l1':
    case 'dictation_word':
    case 'dictation_sentence':
    case 'spelling_bee':
    case 'gap_fill_free':
    case 'error_correct': {
      if (sub.kind !== 'text') throw new Error(`${item.type_id} needs text`);
      const rules = new Set(item.answer.normalise);
      if (item.type_id === 'error_correct') {
        // The sentence handed back unchanged is never right, even when the only error is
        // punctuation that the item's `punct` rule would otherwise wash away (audit 2026-10-03).
        const typed = baseNormalise(sub.text).toLowerCase();
        const unchanged = item.answer.rejected_with_feedback.find((r) => baseNormalise(r.pattern).toLowerCase() === typed);
        if (unchanged) return result('incorrect', expected, { rejected: { errorCode: unchanged.error_code, feedback: unchanged.feedback } });
      }
      const allowTypo = rules.has('typo1') && item.type_id !== 'spelling_bee';
      const m = matchText(sub.text, acceptedForms(item, ctx), rules, ctx, allowTypo);
      if (m.ok) return result('correct', expected, { typo: m.typo });
      let rejected: GradeResult['rejected'] = null;
      if (item.type_id === 'error_correct') {
        for (const r of item.answer.rejected_with_feedback) {
          if (matchText(sub.text, [r.pattern], rules, ctx, false).ok) {
            rejected = { errorCode: r.error_code, feedback: r.feedback };
            break;
          }
        }
      }
      return result('incorrect', expected, { rejected });
    }

    case 'write_sentence': {
      if (sub.kind !== 'text') throw new Error('write_sentence needs text');
      // Free writing: graded by the server's rubric (docs/09 §5 rule 8), never here.
      return result('ungraded', null, { reason: 'free_response' });
    }

    // ------------------------------------------------------------ bank
    case 'word_bank_build':
    case 'sentence_reorder': {
      if (sub.kind !== 'tiles') throw new Error(`${item.type_id} needs tiles`);
      const bank = item.prompt.bank;
      const text = joinTiles(sub.indices.map((i) => bank[i] ?? ''));
      const m = matchText(text, acceptedForms(item, ctx), new Set(item.answer.normalise), ctx, false);
      return result(m.ok ? 'correct' : 'incorrect', expected);
    }

    // ------------------------------------------------------------ order: exact sequence
    case 'listen_order_events': {
      if (sub.kind !== 'order') throw new Error('listen_order_events needs an order');
      const chosen = sub.indices.map((i) => item.prompt.options[i]);
      const key = item.answer.key;
      const elements = key.map((line, i) => chosen[i] === line);
      const ok = chosen.length === key.length && elements.every(Boolean);
      return result(ok ? 'correct' : 'incorrect', expected, { elements });
    }

    // ------------------------------------------------------------ pairs
    case 'tap_pairs':
    case 'memory_match':
    case 'word_race': {
      if (sub.kind !== 'pairs') throw new Error(`${item.type_id} needs pairs`);
      const pairs = item.prompt.pairs;
      const mapping = item.answer.mapping;
      const elements = sub.matches.map(([l, r]) => {
        const left = pairs[l]?.[0];
        const right = pairs[r]?.[1];
        return left !== undefined && right !== undefined && mapping[left] === right;
      });
      const reason = sub.timedOut ? 'timeout' : null;
      if (item.type_id === 'tap_pairs' && sub.mistakes > 0) {
        // docs/09 #1: any mismatch is Again on the item. The pairs a wrong try involved are
        // marked, so the server can tell which lexemes were confused.
        const confused = new Set((sub.attempts ?? []).filter(([l, r]) => l !== r).flatMap(([l, r]) => [l, r]));
        const marked = sub.matches.map(([l], i) => (elements[i] ?? false) && !confused.has(l));
        return result('incorrect', null, { elements: marked, reason });
      }
      // memory_match: wrong flips are the game (scored on time and errors, docs/09 #68);
      // word_race: what was matched before the clock ran out still counts per pair (#69).
      const allMatched = sub.complete && sub.matches.length === pairs.length && elements.every(Boolean);
      return result(allMatched ? 'correct' : 'incorrect', null, { elements, reason });
    }

    // ------------------------------------------------------------ bins
    case 'sort_bins': {
      if (sub.kind !== 'bins') throw new Error('sort_bins needs an assignment');
      const { options, bins } = item.prompt;
      const elements = options.map((word, i) => {
        const b = sub.assignment[i];
        return b !== undefined && bins[b] === item.answer.mapping[word];
      });
      const complete = options.every((_, i) => sub.assignment[i] !== undefined);
      return result(complete && elements.every(Boolean) ? 'correct' : 'incorrect', null, { elements });
    }

    // ------------------------------------------------------------ speak
    case 'repeat_after':
    case 'read_aloud':
    case 'speak_prompt':
    case 'speak_roleplay':
    case 'speak_retell': {
      if (sub.kind !== 'speech') throw new Error(`${item.type_id} needs speech`);
      if (sub.modality === 'voice') return result('ungraded', expected, { reason: 'voice' });
      if (item.answer.key.length === 0) return result('ungraded', null, { reason: 'free_response' });
      // Typed fallback (DECISIONS F20): graded as text; it writes no pronunciation aspect.
      if (item.type_id === 'speak_prompt') {
        // A communicative prompt ("Greeting someone") has many right answers; the key is one
        // exponent. Any listed exponent of the targeted function counts; anything else is not
        // marked wrong on the device — it goes to the server (fluency, docs/06 §4.3).
        const forms = [...item.answer.key, ...(ctx.functionExponents ?? [])];
        const m = matchText(sub.text ?? '', forms, new Set(TYPED_SPEECH_RULES), ctx, false);
        return m.ok ? result('correct', expected) : result('ungraded', expected, { reason: 'free_response' });
      }
      const m = matchText(sub.text ?? '', item.answer.key, new Set(TYPED_SPEECH_RULES), ctx, false);
      return result(m.ok ? 'correct' : 'incorrect', expected);
    }
  }
}

/** Whether a typed text answer is empty after rule 1 — the submit button stays disabled. */
export function isBlank(text: string): boolean {
  return baseNormalise(text).length === 0;
}
