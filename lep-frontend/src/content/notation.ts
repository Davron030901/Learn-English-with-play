/**
 * DECISIONS F24 / content defect C3. 1,159 of the 1,811 minimal-pair items speak a string that
 * is notation, not speech: stress in capitals (REcord / reCORD), IPA between slashes,
 * intonation arrows (I agree↘↗), tone-unit bars, parenthetical directions ("(fall-rise)"),
 * accent labels ("GA 'mate' /meɪt/") and hyphenated syllables. A speech synthesiser cannot
 * produce the contrast those items test, so they are withheld until a human recording exists.
 *
 * The detector below finds exactly those 1,159 (tests/sweep asserts the count).
 */
const IPA_OR_SLASH = /[/ɑɒæɐʌəɛɜɪʊɔθðʃʒŋˈˌːɹɾʔɫʍχβɣɚɝ]/;
const ARROW = /[↗↘↑↓→←⤴⤵]/;
const TONE_BAR = /[|‖]/;
const PAREN = /[()]/;

export type NotationKind = 'ipa' | 'arrow' | 'tone_bar' | 'direction' | 'stress_caps' | 'syllables';

export function notationKind(spoken: string): NotationKind | null {
  if (IPA_OR_SLASH.test(spoken)) return 'ipa';
  if (ARROW.test(spoken)) return 'arrow';
  if (TONE_BAR.test(spoken)) return 'tone_bar';
  if (PAREN.test(spoken)) return 'direction';
  for (const raw of spoken.replace(/[.,!?;:"]/g, '').split(/\s+/)) {
    const w = raw.replace(/^'|'$/g, '');
    if (/[A-Z]{2,}/.test(w)) return 'stress_caps';
    if ((w.match(/-/g) ?? []).length >= 2) return 'syllables';
  }
  return null;
}

/**
 * The accessible name for a minimal-pair option whose only difference from its partner is
 * capitalisation (content defect C4: a screen reader reads REcord and reCORD identically).
 */
export function stressDescription(option: string): { word: string; stressed: string } | null {
  const w = option.trim();
  if (!/[A-Z]{2,}/.test(w) || !/[a-z]/.test(w)) return null;
  // The stressed part is the first upper-case run; lower-case runs can hold several syllables,
  // so the part is named rather than numbered ("representation — stress on 'ta'").
  const stressed = w.match(/[A-Z]{2,}/)?.[0];
  if (!stressed) return null;
  return { word: w.toLowerCase(), stressed: stressed.toLowerCase() };
}
