import type { Lexeme } from '@/content/model';

export type GameMode = 'meaning' | 'spelling' | 'listening';
export interface GameQuestion {
  word: Lexeme;
  clue: string;
  options: string[];
  answer: string;
}

export function normalizeAnswer(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
}

export function shuffle<T>(values: readonly T[], random: () => number = Math.random): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Only unambiguous translated words enter the game. No fabricated distractors. */
export function makeQuestions(
  words: readonly Lexeme[],
  language: string,
  mode: GameMode,
  random: () => number = Math.random,
): GameQuestion[] {
  const seenWords = new Set<string>();
  const seenClues = new Set<string>();
  const pool = words.filter((word) => {
    const lemma = normalizeAnswer(word.lemma);
    const clue = normalizeAnswer(word.gloss[language] ?? '');
    if (!lemma || !clue || seenWords.has(lemma) || seenClues.has(clue)) return false;
    seenWords.add(lemma);
    seenClues.add(clue);
    return true;
  });
  if (pool.length < 4) return [];
  return shuffle(pool, random)
    .slice(0, 10)
    .map((word) => {
      const answer = mode === 'meaning' ? word.gloss[language]! : word.lemma;
      const distractors = shuffle(
        pool.filter((other) => other.id !== word.id),
        random,
      )
        .slice(0, 3)
        .map((other) => (mode === 'meaning' ? other.gloss[language]! : other.lemma));
      return {
        word,
        answer,
        clue: word.gloss[language]!,
        options: shuffle([answer, ...distractors], random),
      };
    });
}
