import type { NormaliseRule } from '@/content/schemas';

import { expandContractions } from './contractions';
import { canonicalSpelling } from './usUk';

/**
 * docs/09 §5 answer normalisation, shared verbatim by the optimistic grader and the offline
 * store (brief §5.7). The item's `normalise[]` says which rules apply; the order is fixed:
 *
 *   (always)  NFKC · curly quotes and dashes folded · whitespace trimmed and collapsed   [rule 1]
 *   contraction → case → punct → spacing → spelling_variant → typo1
 *
 * `typo1` is not a transformation but a comparison mode; it lives in grade.ts.
 *
 * `punct` ignores . , ! ? ; : … and quotation marks anywhere in the answer — the running
 * backend's rule (backend brief §7.1). docs/09 §5 rule 3 names only terminal punctuation but is
 * silent on the rest; a dictation learner must not be failed for an inaudible comma, and items
 * whose target *is* punctuation leave `punct` out (DECISIONS F14, revised).
 */

const QUOTES: Record<string, string> = {
  '‘': "'", // ‘
  '’': "'", // ’
  '‚': "'", // ‚
  '‛': "'", // ‛
  '′': "'", // ′
  'ʼ': "'", // ʼ
  'ʹ': "'", // ʹ
  '`': "'", // `
  '´': "'", // ´
  '“': '"', // “
  '”': '"', // ”
  '„': '"', // „
  '«': '"', // «
  '»': '"', // »
  '″': '"', // ″
  '‐': '-', // ‐
  '‑': '-', // ‑
  '‒': '-', // ‒
  '–': '-', // –
  '—': '-', // —
  '―': '-', // ―
  '−': '-', // −
  '…': '...', // …
  ' ': ' ', // nbsp
};
const QUOTE_RE = new RegExp(`[${Object.keys(QUOTES).join('')}]`, 'g');

/** Rule 1, always applied. */
export function baseNormalise(s: string): string {
  return s
    .normalize('NFKC')
    .replace(QUOTE_RE, (c) => QUOTES[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim();
}

export function applyCase(s: string): string {
  return s.toLowerCase();
}

/**
 * Sentence punctuation and quotation marks go; apostrophes inside words (don't, Aziz's) and
 * hyphens inside words (well-known) stay. A dash standing alone between spaces goes.
 */
export function applyPunct(s: string): string {
  return s
    .replace(/[.,!?;:"]+/g, ' ')
    .replace(/(^|\s)'+|'+(?=\s|$)/g, '$1')
    .replace(/(^|\s)-+(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collapses spaces and removes the space a tile join puts before punctuation ("Aziz ."). */
export function applySpacing(s: string): string {
  return s
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface NormaliseOptions {
  /** `case` also folds the spelling rule's lookups, which are lower-case. */
  rules: ReadonlySet<NormaliseRule>;
}

/**
 * All normalised readings of one string under an item's rules (several when a contraction is
 * ambiguous). Two answers match when their reading sets intersect.
 */
export function normaliseReadings(raw: string, rules: ReadonlySet<NormaliseRule>): string[] {
  let readings = [baseNormalise(raw)];
  if (rules.has('contraction')) readings = readings.flatMap(expandContractions);
  if (rules.has('case')) readings = readings.map(applyCase);
  if (rules.has('punct')) readings = readings.map(applyPunct);
  if (rules.has('spacing') || rules.has('punct')) readings = readings.map(applySpacing);
  if (rules.has('spelling_variant')) {
    readings = readings.map((r) => (rules.has('case') ? canonicalSpelling(r) : canonicalCased(r)));
  }
  return [...new Set(readings)];
}

/** Spelling canonicalisation that keeps the answer's own capitalisation when case matters. */
function canonicalCased(s: string): string {
  return s
    .split(' ')
    .map((token) => {
      const lower = token.toLowerCase();
      const canon = canonicalSpelling(lower);
      if (canon === lower) return token;
      return /^[A-Z]/.test(token) ? canon.charAt(0).toUpperCase() + canon.slice(1) : canon;
    })
    .join(' ');
}
