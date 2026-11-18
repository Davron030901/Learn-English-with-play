import { describe, expect, it } from 'vitest';

import { LexiconIndex } from '@/content/repository';
import { focusWords } from '@/features/chat/focusWords';

const lexicon = new LexiconIndex([
  { id: 'lex.00010', w: 'love', u: 'S01U05' },
  { id: 'lex.00011', w: 'teacher', u: 'S01U02' },
  { id: 'lex.00012', w: 'visit', u: 'S02U01' },
  { id: 'lex.00013', w: 'the', u: 'S01U01' },
  { id: 'lex.00014', w: 'museum', u: 'S03U04' },
  { id: 'lex.00015', w: 'museum', u: 'S01U09' },
  { id: 'lex.00016', w: 'yesterday', u: 'S02U03' },
  { id: 'lex.00017', w: 'quickly', u: 'S04U01' },
]);

describe('the course words a chat correction brought in (§26)', () => {
  it('keeps only words the learner did not say, found in the course', () => {
    expect(
      focusWords('I like my teacher', 'I love my teacher', lexicon).map((w) => w.lemma),
    ).toEqual(['love']);
  });

  it('finds inflected forms, leaves out little words, and takes the earliest unit', () => {
    const got = focusWords('I go museum', 'I visited the museum yesterday', lexicon);
    expect(got.map((w) => w.id)).toEqual(['lex.00012', 'lex.00016']);
    const museum = focusWords('I go', 'the museum', lexicon);
    expect(museum.map((w) => w.unitId)).toEqual(['S01U09']);
  });

  it('a correction that only reorders or adds a little word brings in nothing', () => {
    expect(focusWords('my name Ali', 'My name is Ali', lexicon)).toEqual([]);
    expect(focusWords('teacher my love I', 'I love my teacher', lexicon)).toEqual([]);
  });

  it('at most three, each once', () => {
    const got = focusWords('', 'love love teacher visit yesterday quickly', lexicon);
    expect(got.map((w) => w.lemma)).toEqual(['love', 'teacher', 'visit']);
  });
});
