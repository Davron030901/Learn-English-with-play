import { describe, expect, it } from 'vitest';
import type { Lexeme } from '@/content/model';
import { makeQuestions, normalizeAnswer } from '@/features/arcade/engine';
import { ContentRepository } from '@/content/repository';
import { ALL_UNIT_IDS, fsContentSource } from '../support/fsSource';

const words: Lexeme[] = Array.from({ length: 14 }, (_, i) => ({
  id: String(i),
  lemma: `word ${i}`,
  gloss: { uz: `gloss ${i}` },
  pos: 'noun',
  ipa: '',
  examples: [],
  definitionEn: null,
}));

describe('arcade question generation', () => {
  it.each(['meaning', 'spelling', 'listening'] as const)(
    '%s produces ten questions with unique choices and one answer',
    (mode) => {
      const questions = makeQuestions(words, 'uz', mode);
      expect(questions).toHaveLength(10);
      expect(new Set(questions.map((q) => q.word.id)).size).toBe(10);
      for (const q of questions) {
        expect(q.options).toHaveLength(4);
        expect(new Set(q.options).size).toBe(4);
        expect(q.options.filter((o) => o === q.answer)).toHaveLength(1);
        expect(q.answer).toBe(mode === 'meaning' ? q.word.gloss.uz : q.word.lemma);
      }
    },
  );
  it('excludes ambiguous translations, duplicate lemmas, and missing translations', () => {
    const dirty = [
      ...words,
      { ...words[0]!, id: 'duplicate' },
      { ...words[1]!, id: 'same-clue', lemma: 'another word' },
      { ...words[2]!, id: 'missing', lemma: 'missing', gloss: {} },
    ];
    const questions = makeQuestions(dirty, 'uz', 'meaning', () => 0.5);
    expect(questions.every((q) => !['duplicate', 'same-clue', 'missing'].includes(q.word.id))).toBe(
      true,
    );
  });
  it('does not generate misleading rounds when there are insufficient words', () => {
    expect(makeQuestions(words.slice(0, 3), 'uz', 'meaning')).toEqual([]);
    expect(makeQuestions(words, 'ru', 'listening')).toEqual([]);
  });
  it('accepts case, Unicode apostrophe and whitespace differences without ignoring spelling mistakes', () => {
    expect(normalizeAnswer('  It’S   mine ')).toBe("it's mine");
    expect(normalizeAnswer('freind')).not.toBe(normalizeAnswer('friend'));
  });
  it('generates playable, unambiguous rounds throughout the real course in Uzbek and Russian', async () => {
    const repository = new ContentRepository(fsContentSource);
    for (const id of ALL_UNIT_IDS) {
      const unit = await repository.loadUnit(id);
      for (const language of ['uz', 'ru']) {
        for (const mode of ['meaning', 'spelling', 'listening'] as const) {
          const questions = makeQuestions(unit.lexemes, language, mode);
          expect(questions.length, `${id}/${language}/${mode}`).toBeGreaterThanOrEqual(4);
          for (const q of questions) {
            expect(new Set(q.options.map(normalizeAnswer)).size).toBe(4);
            expect(q.options).toContain(q.answer);
          }
        }
      }
    }
  });
});
