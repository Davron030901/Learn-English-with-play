import type { LexiconEntry, LexiconIndex } from '@/content/repository';

/**
 * The course words a chat correction brought in (frontend DECISIONS §26): the words of the
 * corrected form that the learner's own words did not have, found in the course's lexicon — at
 * most three, each once, the earliest unit first. Little grammar words are left out: saving
 * "the" teaches nothing. A correction that only reorders or inflects what was said brings in
 * none, and gets no save button.
 */

const LITTLE_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'and',
  'or',
  'but',
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'do',
  'does',
  'did',
  'not',
  'my',
  'your',
  'me',
]);

const WORD = /[A-Za-z][A-Za-z'’]*/g;

const words = (text: string) =>
  (text.match(WORD) ?? []).map((w) => w.toLowerCase().replace(/’/g, "'"));

export function focusWords(
  original: string,
  corrected: string,
  lexicon: LexiconIndex,
  max = 3,
): LexiconEntry[] {
  const had = new Set(words(original));
  const out: LexiconEntry[] = [];
  const seen = new Set<string>();
  for (const w of words(corrected)) {
    if (out.length === max) break;
    if (had.has(w) || LITTLE_WORDS.has(w)) continue;
    const [entry] = lexicon.byUnitOrder(lexicon.lookup(w));
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}
