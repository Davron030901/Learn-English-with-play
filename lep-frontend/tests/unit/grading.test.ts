import { describe, expect, it } from 'vitest';

import type { NormaliseRule } from '@/content/schemas';
import { expandContractions } from '@/grading/contractions';
import { osaDistance, withinOneEdit } from '@/grading/distance';
import { feedbackContent } from '@/grading/feedback';
import { expectedAnswer, grade, gradableOffline, isBlank, joinTiles, matchText, type GradeContext } from '@/grading/grade';
import { deriveHint } from '@/grading/hints';
import { applyPunct, baseNormalise } from '@/grading/normalise';
import { canonicalSpelling, lexicalAlternatives } from '@/grading/usUk';

import { makeItem } from '../support/items';

/** A slice of the course's own English word list: the real-word exclusion of typo1. */
const WORDS: ReadonlySet<string> = new Set(['form', 'from', 'quiet', 'quite', 'desert', 'dessert', 'the', 'then', 'than', 'were', 'where', 'live', 'love', 'house', 'horse']);
const ctx: GradeContext = { words: WORDS };
const R = (...rules: NormaliseRule[]): ReadonlySet<NormaliseRule> => new Set(rules);

describe('rule 1 — always applied', () => {
  it('folds NFKC, curly quotes, dashes and whitespace', () => {
    expect(baseNormalise('  I’m   here — now…  ')).toBe("I'm here - now...");
    expect(baseNormalise('ﬁne')).toBe('fine'); // NFKC ligature
    expect(baseNormalise('“Hello” there')).toBe('"Hello" there');
  });
  it('blank answers stay blank so the check button stays disabled', () => {
    expect(isBlank('   \n\t ')).toBe(true);
    expect(isBlank(' a ')).toBe(false);
  });
});

describe('item-driven rules', () => {
  it('contraction: full and contracted forms match both ways, ambiguities expand', () => {
    const rules = R('contraction', 'case');
    expect(matchText("I'm a student", ['I am a student'], rules, ctx, false).ok).toBe(true);
    expect(matchText('I am a student', ["I'm a student"], rules, ctx, false).ok).toBe(true);
    expect(matchText("She's got a cat", ['She has got a cat'], rules, ctx, false).ok).toBe(true);
    expect(expandContractions("he's")).toEqual(['he is', 'he has']);
    // A possessive never expands.
    expect(expandContractions("Aziz's book")).toEqual(["Aziz's book"]);
  });
  it('contraction absent = the contraction is the target: forms are not interchangeable', () => {
    expect(matchText("I'm a student", ['I am a student'], R('case', 'punct'), ctx, false).ok).toBe(false);
  });
  it('case only folds when the item says so', () => {
    expect(matchText('hello', ['Hello'], R('case'), ctx, false).ok).toBe(true);
    expect(matchText('hello', ['Hello'], R('punct'), ctx, false).ok).toBe(false);
  });
  it('punct ignores sentence punctuation and quotes anywhere, keeps word-internal marks', () => {
    expect(applyPunct('Hello, my name is "Aziz".')).toBe('Hello my name is Aziz');
    expect(applyPunct("don't stop - it's well-known")).toBe("don't stop it's well-known");
    expect(matchText('Hello my name is Aziz', ['Hello! My name is Aziz.'], R('case', 'punct'), ctx, false).ok).toBe(true);
  });
  it('spacing removes the space a tile join leaves before punctuation', () => {
    expect(matchText('I am Aziz .', ['I am Aziz.'], R('spacing'), ctx, false).ok).toBe(true);
  });
});

describe('US/UK spelling — both always accepted (DECISIONS F13)', () => {
  it('orthographic pairs canonicalise anywhere in the answer', () => {
    expect(canonicalSpelling('my favourite colour')).toBe('my favorite color');
    expect(matchText('My favourite colour is blue', ['My favorite color is blue'], R('case', 'spelling_variant'), ctx, false).ok).toBe(true);
    expect(matchText('My favorite color is blue', ['My favourite colour is blue'], R('case', 'spelling_variant'), ctx, false).ok).toBe(true);
  });
  it('a rule never invents spellings (doctor stays doctor)', () => {
    expect(canonicalSpelling('doctor')).toBe('doctor');
  });
  it('lexical pairs apply only to the lexeme the item targets, on word boundaries', () => {
    expect(lexicalAlternatives('I live in a flat', ['flat'])).toEqual(['I live in a apartment']);
    expect(lexicalAlternatives('I live in a flat', ['house'])).toEqual([]);
    expect(lexicalAlternatives('I checked the bill', ['bill'])).toEqual(['I checked the check']);
    const item = makeItem('type_from_l1', { text_uz: 'kino' }, { key: ['film'], normalise: ['case', 'spelling_variant'] });
    expect(grade(item, { kind: 'text', text: 'movie' }, { words: WORDS, targetLemmas: ['film'] }).verdict).toBe('correct');
    expect(grade(item, { kind: 'text', text: 'movie' }, { words: WORDS, targetLemmas: [] }).verdict).toBe('incorrect');
  });
});

describe('typo1 — one edit, guarded (docs/09 §5 rule 7)', () => {
  const item = (key: string, extra: string[] = []) =>
    makeItem('type_from_l1', { text_uz: 'x' }, { key: [key], normalise: ['case', 'punct', 'typo1', ...extra] });

  it('accepts one slip in a long enough word and says "watch the spelling"', () => {
    const r = grade(item('because'), { kind: 'text', text: 'becuase' }, ctx);
    expect(r.verdict).toBe('correct');
    expect(r.typo).toEqual({ typed: 'becuase', expected: 'because' });
    const fb = feedbackContent(item('because'), r, undefined, 'uz', WORDS);
    expect(fb.typo).toEqual({ typed: 'becuase', expected: 'because' });
  });
  it('never accepts a real English word: form/from, quiet/quite, desert/dessert', () => {
    expect(grade(item('from'), { kind: 'text', text: 'form' }, ctx).verdict).toBe('incorrect');
    expect(grade(item('quiet'), { kind: 'text', text: 'quite' }, ctx).verdict).toBe('incorrect');
    expect(grade(item('dessert'), { kind: 'text', text: 'desert' }, ctx).verdict).toBe('incorrect');
  });
  it('short words (< 4 characters) get no tolerance', () => {
    expect(grade(item('cat'), { kind: 'text', text: 'cta' }, ctx).verdict).toBe('incorrect');
  });
  it('only one word may differ, by one edit', () => {
    expect(grade(item('my sister lives here'), { kind: 'text', text: 'my sistr lives here' }, ctx).verdict).toBe('correct');
    expect(grade(item('my sister lives here'), { kind: 'text', text: 'my sistr livs here' }, ctx).verdict).toBe('incorrect');
    expect(grade(item('because'), { kind: 'text', text: 'bcuase' }, ctx).verdict).toBe('incorrect');
  });
  it('never in spelling_bee, where the spelling is the answer', () => {
    const bee = makeItem('spelling_bee', { audio: 'audio/w.mp3' }, { key: ['because'], normalise: ['case', 'typo1'] });
    expect(grade(bee, { kind: 'text', text: 'becuase' }, ctx).verdict).toBe('incorrect');
  });
  it('the edit distance is Damerau (transposition counts as one)', () => {
    expect(withinOneEdit('becuase', 'because')).toBe(true);
    expect(osaDistance('becuase', 'because')).toBe(1);
    expect(withinOneEdit('kitten', 'sitting')).toBe(false);
  });
});

describe('per family', () => {
  it('choice grades by canonical index', () => {
    const it = makeItem('mcq_word_from_definition', { text_uz: 'salom', options: ['bye', 'hello', 'name', 'we'] }, { index: 1 });
    expect(grade(it, { kind: 'choice', index: 1 }, ctx).verdict).toBe('correct');
    const wrong = grade(it, { kind: 'choice', index: 0 }, ctx);
    expect(wrong.verdict).toBe('incorrect');
    expect(wrong.expected).toBe('hello');
  });
  it('gap_fill_bank grades the chosen word as text', () => {
    const it = makeItem('gap_fill_bank', { text: '___! My name is Aziz.', bank: ['goodbye', 'bye', 'hi', 'Hello'] }, { key: ['Hello'], normalise: ['case'] });
    expect(grade(it, { kind: 'text', text: 'Hello' }, ctx).verdict).toBe('correct');
    expect(grade(it, { kind: 'text', text: 'bye' }, ctx).verdict).toBe('incorrect');
  });
  it('bank tiles join with punctuation attached, by index (a bank may repeat a word)', () => {
    expect(joinTiles(['I', 'am', 'Aziz', '.'])).toBe('I am Aziz.');
    expect(joinTiles(['I', 'do', "n't", 'know'])).toBe("I don't know");
    const it = makeItem('sentence_reorder', { bank: ['the', 'cat', 'sees', 'the', 'dog', '.'] }, { key: ['the cat sees the dog.'], normalise: ['case'] });
    expect(grade(it, { kind: 'tiles', indices: [0, 1, 2, 3, 4, 5] }, ctx).verdict).toBe('correct');
    expect(grade(it, { kind: 'tiles', indices: [3, 1, 2, 0, 4, 5] }, ctx).verdict).toBe('correct');
    expect(grade(it, { kind: 'tiles', indices: [4, 2, 3, 1, 0, 5] }, ctx).verdict).toBe('incorrect');
  });
  it('order must match exactly, element by element', () => {
    const it = makeItem('listen_order_events', { audio: 'a.mp3', options: ['b', 'a', 'c'] }, { key: ['a', 'b', 'c'] });
    const ok = grade(it, { kind: 'order', indices: [1, 0, 2] }, ctx);
    expect(ok.verdict).toBe('correct');
    const bad = grade(it, { kind: 'order', indices: [0, 1, 2] }, ctx);
    expect(bad.verdict).toBe('incorrect');
    expect(bad.elements).toEqual([false, false, true]);
  });
  it('pairs are correct only when every pair is matched', () => {
    const it = makeItem('tap_pairs', { pairs: [['hello', 'salom'], ['bye', 'xayr']] }, { mapping: { hello: 'salom', bye: 'xayr' } });
    expect(grade(it, { kind: 'pairs', matches: [[0, 0], [1, 1]], mistakes: 0, complete: true }, ctx).verdict).toBe('correct');
    expect(grade(it, { kind: 'pairs', matches: [[0, 0]], mistakes: 0, complete: false }, ctx).verdict).toBe('incorrect');
  });
  it('tap_pairs: any mismatch is Again on the item, with the confused pairs marked (docs/09 #1)', () => {
    const it = makeItem(
      'tap_pairs',
      { pairs: [['hello', 'salom'], ['bye', 'xayr'], ['name', 'ism']] },
      { mapping: { hello: 'salom', bye: 'xayr', name: 'ism' } },
    );
    const r = grade(
      it,
      { kind: 'pairs', matches: [[0, 0], [1, 1], [2, 2]], mistakes: 1, complete: true, attempts: [[0, 1], [0, 0], [1, 1], [2, 2]] },
      ctx,
    );
    expect(r.verdict).toBe('incorrect');
    expect(r.elements).toEqual([false, false, true]);
  });
  it('memory_match: wrong flips are the game, not a failure (docs/09 #68)', () => {
    const it = makeItem('memory_match', { pairs: [['hello', 'salom'], ['bye', 'xayr']] }, { mapping: { hello: 'salom', bye: 'xayr' } });
    expect(grade(it, { kind: 'pairs', matches: [[0, 0], [1, 1]], mistakes: 3, complete: true }, ctx).verdict).toBe('correct');
  });
  it('word_race: a game whose clock ran out keeps the pairs it matched', () => {
    const it = makeItem('word_race', { pairs: [['hello', 'salom'], ['bye', 'xayr']] }, { mapping: { hello: 'salom', bye: 'xayr' } });
    const r = grade(it, { kind: 'pairs', matches: [[1, 1]], mistakes: 0, complete: false, timedOut: true }, ctx);
    expect(r.verdict).toBe('incorrect');
    expect(r.reason).toBe('timeout');
    expect(r.elements).toEqual([true]);
  });
  it('error_correct: the sentence handed back unchanged is never right, even under punct', () => {
    const it = makeItem(
      'error_correct',
      { text: 'Where do you live.' },
      { key: ['Where do you live?'], normalise: ['case', 'punct'], rejected_with_feedback: [{ pattern: 'Where do you live.', feedback: 'A question ends with ?', error_code: 'PUNCT' }] },
    );
    expect(grade(it, { kind: 'text', text: 'Where do you live.' }, ctx).verdict).toBe('incorrect');
    expect(grade(it, { kind: 'text', text: 'Where do you live?' }, ctx).verdict).toBe('correct');
  });
  it('bins need every word placed, each in its own bin', () => {
    const it = makeItem('sort_bins', { options: ['cat', 'run'], bins: ['noun', 'verb'] }, { mapping: { cat: 'noun', run: 'verb' } });
    expect(grade(it, { kind: 'bins', assignment: { 0: 0, 1: 1 } }, ctx).verdict).toBe('correct');
    expect(grade(it, { kind: 'bins', assignment: { 0: 1, 1: 0 } }, ctx).elements).toEqual([false, false]);
    expect(grade(it, { kind: 'bins', assignment: { 0: 0 } }, ctx).verdict).toBe('incorrect');
  });
  it('error_correct returns the matched rejected pattern for its feedback and error code', () => {
    const it = makeItem(
      'error_correct',
      { text: 'She go to school.' },
      { key: ['She goes to school.'], normalise: ['case', 'punct'], rejected_with_feedback: [{ pattern: 'She go to school.', feedback: 'Add -s for he/she/it.', error_code: 'SV' }] },
    );
    const r = grade(it, { kind: 'text', text: 'she go to school' }, ctx);
    expect(r.verdict).toBe('incorrect');
    expect(r.rejected).toEqual({ errorCode: 'SV', feedback: 'Add -s for he/she/it.' });
    const fb = feedbackContent(it, r, undefined, 'uz', WORDS);
    expect(fb.diagnosis).toBe('SV');
    expect(fb.why).toBe('Add -s for he/she/it.');
  });
  it('an unknown error code is never shown as a diagnosis (no "GRAM", C8)', () => {
    const it = makeItem('error_correct', { text: 'x' }, { key: ['y'], rejected_with_feedback: [{ pattern: 'x', feedback: 'f', error_code: 'GRAM' }] });
    const r = grade(it, { kind: 'text', text: 'x' }, ctx);
    expect(feedbackContent(it, r, undefined, 'uz', WORDS).diagnosis).toBeNull();
  });
});

describe('what the device never grades', () => {
  it('free writing is ungraded', () => {
    const it = makeItem('write_sentence', { text: 'Write about your family.' }, { key: [], normalise: [] });
    expect(gradableOffline(it)).toBe(false);
    expect(grade(it, { kind: 'text', text: 'My family is big.' }, ctx)).toMatchObject({ verdict: 'ungraded', reason: 'free_response' });
  });
  it('a recording is never scored on the device', () => {
    const it = makeItem('read_aloud', { text: 'Hello! My name is Aziz.' }, { key: ['Hello! My name is Aziz.'] });
    expect(grade(it, { kind: 'speech', modality: 'voice' }, ctx)).toMatchObject({ verdict: 'ungraded', reason: 'voice' });
  });
  it('typed speech is graded as text with the speaking rules', () => {
    const it = makeItem('read_aloud', { text: 'Hello! My name is Aziz.' }, { key: ['Hello! My name is Aziz.'] });
    expect(grade(it, { kind: 'speech', modality: 'typed', text: 'hello my name is aziz' }, ctx).verdict).toBe('correct');
    expect(grade(it, { kind: 'speech', modality: 'typed', text: 'hello my name is bob' }, ctx).verdict).toBe('incorrect');
  });
  it('speak_prompt accepts any listed exponent of its function; anything else goes to the server', () => {
    const it = makeItem('speak_prompt', { text: 'Greet someone.' }, { key: ['Hello!'] });
    const fn = { words: WORDS, functionExponents: ['Hi!', 'Good morning!'] };
    expect(grade(it, { kind: 'speech', modality: 'typed', text: 'good morning' }, fn).verdict).toBe('correct');
    expect(grade(it, { kind: 'speech', modality: 'typed', text: 'Hey there, friend' }, fn)).toMatchObject({ verdict: 'ungraded', reason: 'free_response' });
  });
  it('a timeout is graded Again, never skipped (docs/09 §6)', () => {
    const it = makeItem('dictation_word', { audio: 'a.mp3' }, { key: ['house'], normalise: ['case'] });
    const r = grade(it, { kind: 'timeout' }, ctx);
    expect(r).toMatchObject({ verdict: 'incorrect', reason: 'timeout', expected: 'house' });
    expect(feedbackContent(it, r, undefined, 'uz', WORDS).timeout).toBe(true);
  });
  it('expectedAnswer reads the key, not a guess', () => {
    expect(expectedAnswer(makeItem('stress_tap', { text: 'hello', audio: 'a', syllables: ['hel', 'lo'] }, { index: 1 }))).toBe('lo');
    expect(expectedAnswer(makeItem('tap_pairs', { pairs: [['a', 'b']] }, { mapping: { a: 'b' } }))).toBeNull();
  });
});

describe('hints are derived from the item, never invented (DECISIONS F18)', () => {
  it('type_from_l1: the first letter', () => {
    const it = makeItem('type_from_l1', { text_uz: 'uy' }, { key: ['house'] }, { constraints: { hints_allowed: 1 } });
    expect(deriveHint(it)).toEqual({ kind: 'first_letter', letter: 'h' });
  });
  it('error_correct: where the prompt and key differ', () => {
    const it = makeItem('error_correct', { text: 'She go to school.' }, { key: ['She goes to school.'] }, { constraints: { hints_allowed: 1 } });
    expect(deriveHint(it)).toEqual({ kind: 'look_at', span: 'go' });
    const missing = makeItem('error_correct', { text: 'I student.' }, { key: ['I am a student.'] }, { constraints: { hints_allowed: 1 } });
    expect(deriveHint(missing)).toEqual({ kind: 'missing_after', word: 'I' });
  });
  it('no hint when the item allows none, or for other types', () => {
    expect(deriveHint(makeItem('type_from_l1', { text_uz: 'uy' }, { key: ['house'] }))).toBeNull();
    expect(deriveHint(makeItem('gap_fill_free', { text: 'I ___ here.' }, { key: ['live'] }, { constraints: { hints_allowed: 1 } }))).toBeNull();
  });
});
