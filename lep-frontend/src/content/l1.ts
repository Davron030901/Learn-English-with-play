import type { Item } from './schemas';
import type { Lexeme } from './model';

/**
 * The L1 layer (brief §14, DECISIONS F23). The build writes the learner's first language into
 * items in three ways:
 *   * `prompt.text_uz` — always the target lexeme's Uzbek gloss (11,237 of 11,237);
 *   * the right-hand side of every pair item — Uzbek glosses of the left-hand lexemes;
 *   * feedback strings — 16,645 of 24,608 `incorrect_default` contain Uzbek, as prose or in the
 *     form `'salom' = hello`.
 * For an Uzbek-L1 learner that is all correct. For any other L1 the client resolves each gloss
 * to the learner's language from the lexicon, rewrites `'uz' = en` feedback the same way, and
 * *hides* Uzbek prose it cannot translate — it never shows Uzbek to a learner whose L1 is not
 * Uzbek, and never invents a translation.
 */

export const CONTENT_L1 = 'uz';

const GLOSS_FEEDBACK = /^'(.+)' = (.+?)(\.?)$/s;

const UZ_FUNCTION_WORDS = new Set([
  'va', 'bu', 'bilan', 'uchun', 'emas', 'ham', 'yoki', 'esa', 'ekan', 'lekin', 'faqat', 'har',
  'shu', 'uni', 'ular', 'bir', 'xil', 'doim', 'odatda', 'keyin', 'oldin', 'kerak', 'deb',
  'qilib', 'ni', 'dan', 'ga', 'ning', 'yoq', 'hech', 'qachon', 'agar', 'chunki', 'nima', 'kim',
  'qanday', 'qayerda', 'hozir', 'ingliz', 'tilida', 'masalan', 'yani', 'undoshdan', 'unli',
]);

const tokensOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .match(/[a-z]+(?:'[a-z]+)*/g) ?? [];

/** Heuristic, calibrated on every feedback string in the corpus. `english` is the course's word list. */
export function looksUzbek(text: string, english: ReadonlySet<string>): boolean {
  const toks = tokensOf(text);
  // Uzbek Latin writes o', g' and the tutuq belgisi inside words (o'z, fe'l, ma'no); English
  // apostrophes inside a word are contractions or possessives.
  if (toks.some((t) => /^[a-z]+'[a-z]+$/.test(t) && !/'(s|t|re|ve|ll|d|m)$/.test(t) && t !== "o'clock")) {
    return true;
  }
  const long = toks.filter((t) => t.length >= 2);
  const uzHits = long.filter((t) => UZ_FUNCTION_WORDS.has(t)).length;
  const nonEnglishLong = long.filter((t) => t.length >= 4 && !english.has(t)).length;
  if (uzHits >= 2 || (uzHits >= 1 && nonEnglishLong >= 1)) return true;
  if (long.length < 3) return false;
  const en = long.filter((t) => english.has(t)).length;
  return en / long.length < 0.5;
}

function targetLexemes(item: Item, lexemes: readonly Lexeme[]): Lexeme[] {
  const ids = new Set(item.targets.lexis ?? []);
  return lexemes.filter((l) => ids.has(l.id));
}

/** The learner's L1 gloss for an Uzbek gloss the item carries; null if none exists. */
export function glossFor(uzGloss: string, l1: string, candidates: readonly Lexeme[]): string | null {
  if (l1 === CONTENT_L1) return uzGloss;
  const hit = candidates.find((l) => l.gloss[CONTENT_L1] === uzGloss);
  const g = hit?.gloss[l1];
  return g && g.trim() ? g : null;
}

/** `prompt.text_uz` in the learner's L1 (brief §5.3: "the L1 prompt for this learner's language"). */
export function l1Prompt(item: Item, l1: string, lexemes: readonly Lexeme[]): string | null {
  if (!('text_uz' in item.prompt)) return null;
  const uz = item.prompt.text_uz;
  if (!uz) return null;
  const targets = targetLexemes(item, lexemes);
  return glossFor(uz, l1, targets.length ? targets : lexemes);
}

/** The right-hand side of pair `index`, in the learner's L1. */
export function l1PairGloss(
  item: Extract<Item, { type_id: 'tap_pairs' | 'memory_match' | 'word_race' }>,
  index: number,
  l1: string,
  lexemes: readonly Lexeme[],
): string | null {
  const pair = item.prompt.pairs[index];
  if (!pair) return null;
  const [left, right] = pair;
  if (l1 === CONTENT_L1) return right;
  const byLemma = lexemes.find((l) => l.lemma === left && l.gloss[CONTENT_L1] === right);
  const g = byLemma?.gloss[l1] ?? glossFor(right, l1, lexemes);
  return g && g.trim() ? g : null;
}

/**
 * A feedback string in the learner's L1: unchanged for Uzbek learners; `'uz' = en` rewritten to
 * the learner's gloss; Uzbek prose hidden (null) for everyone else.
 */
export function l1Feedback(
  text: string | undefined,
  l1: string,
  item: Item,
  lexemes: readonly Lexeme[],
  english: ReadonlySet<string>,
): string | null {
  if (!text) return null;
  if (l1 === CONTENT_L1) return text;
  const m = text.match(GLOSS_FEEDBACK);
  if (m) {
    const [, uz = '', en = '', dot = ''] = m;
    const targets = targetLexemes(item, lexemes);
    const g = glossFor(uz, l1, targets.length ? targets : lexemes);
    return g ? `'${g}' = ${en}${dot}` : null;
  }
  return looksUzbek(text, english) ? null : text;
}
