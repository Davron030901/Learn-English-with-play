import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import type { Item } from '@/content/schemas';
import { ContentRepository } from '@/content/repository';
import { gradeContextFor, toSubmissionRecord } from '@/features/lesson/record';
import { grade, type Submission } from '@/grading/grade';

import { correctSubmission, wrongSubmission } from '../support/answers';
import { ALL_UNIT_IDS, fsContentSource } from '../support/fsSource';

/**
 * Exports grading vectors for the server's grader (lep-backend tests/unit/test_grading_parity.py):
 * real items, the submissions a learner could make — right, wrong, and the near-misses the
 * normalisation rules exist for (case, punctuation, spacing, curly quotes, contractions, US/UK
 * spellings, one-letter slips) — and the verdict this grader gives each one. Client and server
 * must agree on every vector.
 *
 *   LEP_EXPORT_VECTORS=../lep-backend/tests/fixtures/grading-vectors.json.gz npx vitest run tests/sweep/vectors.test.ts
 *
 * The sample is deterministic: near-misses for every third text item, right and wrong answers for
 * every item of a text, bank or speech type and for every fifth item of the other families.
 */

const OUT = process.env.LEP_EXPORT_VECTORS;

interface Vector {
  i: string;
  s: unknown;
  v: string;
  t: [string, string] | null;
  r: string | null;
}

const idNumber = (id: string) => Number(id.slice(5));

const TEXTUAL = new Set([
  'gap_fill_bank',
  'type_from_l1',
  'dictation_word',
  'dictation_sentence',
  'spelling_bee',
  'gap_fill_free',
  'error_correct',
  'word_bank_build',
  'sentence_reorder',
  'repeat_after',
  'read_aloud',
  'speak_prompt',
  'speak_roleplay',
  'speak_retell',
]);

const SWAPS: [RegExp, string][] = [
  [/\bdo not\b/i, "don't"],
  [/\bdon't\b/i, 'do not'],
  [/\bI am\b/, "I'm"],
  [/\bI'm\b/, 'I am'],
  [/\bit is\b/i, "it's"],
  [/\bcannot\b/i, "can't"],
  [/\bcolor\b/i, 'colour'],
  [/\bcolour\b/i, 'color'],
  [/\bcentre\b/i, 'center'],
  [/\bcenter\b/i, 'centre'],
  [/ise\b/, 'ize'],
  [/ize\b/, 'ise'],
  [/\bflat\b/i, 'apartment'],
  [/\bfilm\b/i, 'movie'],
];

function longestWord(text: string): { word: string; at: number } | null {
  let best: { word: string; at: number } | null = null;
  for (const m of text.matchAll(/[A-Za-z]+/g)) {
    if (!best || m[0].length > best.word.length) best = { word: m[0], at: m.index };
  }
  return best && best.word.length >= 4 ? best : null;
}

function nearMisses(key: string): string[] {
  const out = new Set<string>([
    key.toUpperCase(),
    key.toLowerCase(),
    `  ${key}!!  `,
    key.replace(/[.!?]+$/, ''),
    key.replace(/ /g, '  '),
    key.replace(/'/g, '’'),
    `"${key}"`,
  ]);
  for (const [re, to] of SWAPS) if (re.test(key)) out.add(key.replace(re, to));
  const w = longestWord(key);
  if (w) {
    const { word, at } = w;
    const mid = Math.floor(word.length / 2);
    const swap = word.slice(0, mid - 1) + word.charAt(mid) + word.charAt(mid - 1) + word.slice(mid + 1);
    const drop = word.slice(0, mid) + word.slice(mid + 1);
    const sub = word.slice(0, mid) + (word.charAt(mid) === 'x' ? 'q' : 'x') + word.slice(mid + 1);
    const twice = word.slice(0, 1) + word.slice(2, mid) + 'zz' + word.slice(mid + 1);
    for (const v of [swap, drop, sub, twice]) out.add(key.slice(0, at) + v + key.slice(at + word.length));
  }
  out.delete(key);
  return [...out];
}

function textVariants(item: Item, right: Submission): Submission[] {
  const keyText =
    right.kind === 'text' ? right.text : right.kind === 'speech' && right.modality === 'typed' ? (right.text ?? '') : null;
  if (keyText === null) return [];
  return nearMisses(keyText).map((t) =>
    right.kind === 'speech' ? ({ kind: 'speech', modality: 'typed', text: t } as Submission) : ({ kind: 'text', text: t } as Submission),
  );
}

describe('grading vectors for the server', () => {
  it.skipIf(!OUT)('exports client verdicts over the real corpus', async () => {
    const repo = new ContentRepository(fsContentSource);
    const words = await repo.loadWords();
    const vectors: Vector[] = [];
    for (const unitId of ALL_UNIT_IDS) {
      const unit = await repo.loadUnit(unitId);
      const all = unit.nodes.flatMap((n) => [1, 2, 3].flatMap((t) => n.tiers[t as 1 | 2 | 3] ?? []));
      const otherKeys = all.flatMap((it) => ('key' in it.answer ? (it.answer as { key: string[] }).key.slice(0, 1) : []));
      for (const item of all) {
        const n = idNumber(item.id);
        const textual = TEXTUAL.has(item.type_id);
        if (!textual && n % 5 !== 0) continue;
        const ctx = gradeContextFor(item, unit, words);
        const subs: Submission[] = [];
        const right = correctSubmission(item);
        if (right) subs.push(right);
        const wrong = wrongSubmission(
          item,
          otherKeys.filter((k) => !('key' in item.answer && (item.answer as { key: string[] }).key.includes(k))),
        );
        if (wrong) subs.push(wrong);
        if (textual && right && n % 3 === 0) subs.push(...textVariants(item, right));
        if (right && right.kind === 'pairs' && right.matches.length >= 2) {
          // a mix-up on the way, then everything matched; and a clock that ran out half-way
          const [first, second] = right.matches as [[number, number], [number, number]];
          subs.push({ ...right, mistakes: 1, attempts: [[first[0], second[1]], ...right.matches] });
          subs.push({ kind: 'pairs', matches: right.matches.slice(0, Math.floor(right.matches.length / 2)), mistakes: 0, complete: false, timedOut: true });
        }
        subs.push({ kind: 'timeout' });
        for (const sub of subs) {
          const r = grade(item, sub, ctx);
          vectors.push({
            i: item.id,
            s: toSubmissionRecord(item, sub),
            v: r.verdict,
            t: r.typo ? [r.typo.typed, r.typo.expected] : null,
            r: r.rejected?.errorCode ?? null,
          });
        }
      }
    }
    expect(vectors.length).toBeGreaterThan(30000);
    const out = OUT as string;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, gzipSync(JSON.stringify(vectors), { level: 9 }));
    console.log(`grading vectors: ${vectors.length} → ${out}`);
  });
});
