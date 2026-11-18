import { beforeAll, describe, expect, it } from 'vitest';

import type { Unit } from '@/content/model';
import { notationKind } from '@/content/notation';
import { ContentRepository } from '@/content/repository';
import { TYPE_IDS, type Item, type TypeId } from '@/content/schemas';
import { FAMILY, grade, gradableOffline, type GradeContext } from '@/grading/grade';

import { correctSubmission, wrongSubmission } from '../support/answers';
import { ALL_UNIT_IDS, fsContentSource } from '../support/fsSource';

/**
 * The full corpus sweep (brief §16.1, Phase 3 acceptance): every one of the 37,173 items is
 * parsed into the envelope, its key grades correct, and a verified-wrong answer grades wrong,
 * with zero exceptions. Free speech and free writing grade `ungraded`, never correct.
 */

const repo = new ContentRepository(fsContentSource);
let units: Unit[] = [];
let words: ReadonlySet<string>;

beforeAll(async () => {
  words = await repo.loadWords();
  units = await Promise.all(ALL_UNIT_IDS.map((id) => repo.loadUnit(id)));
});

function itemsOf(unit: Unit): Item[] {
  return unit.nodes.flatMap((n) => [1, 2, 3].flatMap((t) => n.tiers[t as 1 | 2 | 3] ?? []));
}

describe('corpus sweep', () => {
  it('parses every item into the envelope', () => {
    const all = units.flatMap(itemsOf);
    const shapeDefects = units.flatMap((u) => u.defects.filter((d) => d.code === 'item_shape'));
    expect(shapeDefects).toEqual([]);
    expect(all.length).toBe(37173);
    expect(new Set(all.map((i) => i.id)).size).toBe(37173);
    const types = new Set(all.map((i) => i.type_id));
    expect(types.size).toBe(31);
    for (const t of types) expect(TYPE_IDS).toContain(t);
  });

  it('grades every key correct and every verified-wrong answer wrong, with no exceptions', () => {
    const stats: Record<string, { correct: number; wrong: number; ungraded: number; noWrong: number }> = {};
    const failures: string[] = [];
    let cycles = 0;
    for (const unit of units) {
      const all = itemsOf(unit);
      const keysByType = new Map<TypeId, string[]>();
      for (const it of all) {
        const k = 'key' in it.answer ? (it.answer as { key: string[] }).key[0] : undefined;
        if (k) keysByType.set(it.type_id, [...(keysByType.get(it.type_id) ?? []), k]);
      }
      const lemmaById = new Map(unit.lexemes.map((l) => [l.id, l.lemma]));
      for (const item of all) {
        const s = (stats[item.type_id] ??= { correct: 0, wrong: 0, ungraded: 0, noWrong: 0 });
        const ctx: GradeContext = {
          words,
          targetLemmas: (item.targets.lexis ?? []).map((id) => lemmaById.get(id) ?? '').filter(Boolean),
        };
        try {
          const right = correctSubmission(item);
          if (!right) {
            failures.push(`${item.id} ${item.type_id}: no correct submission could be built`);
            continue;
          }
          const r = grade(item, right, ctx);
          cycles += 1;
          if (gradableOffline(item) && r.verdict !== 'correct') {
            failures.push(`${item.id} ${item.type_id}: key graded ${r.verdict}`);
          }
          if (!gradableOffline(item) && r.verdict !== 'ungraded') {
            failures.push(`${item.id} ${item.type_id}: free response graded ${r.verdict}`);
          }
          if (r.verdict === 'correct') s.correct += 1;
          if (r.verdict === 'ungraded') s.ungraded += 1;
          const others = (keysByType.get(item.type_id) ?? []).filter(
            (k) => !('key' in item.answer && (item.answer as { key: string[] }).key.includes(k)),
          );
          const wrong = wrongSubmission(item, others);
          if (!wrong) {
            s.noWrong += 1;
            continue;
          }
          const w = grade(item, wrong, ctx);
          cycles += 1;
          if (w.verdict !== 'incorrect') failures.push(`${item.id} ${item.type_id}: wrong answer graded ${w.verdict}`);
          else s.wrong += 1;
        } catch (e) {
          failures.push(`${item.id} ${item.type_id}: threw ${String(e)}`);
        }
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
    const totalCorrect = Object.values(stats).reduce((a, s) => a + s.correct, 0);
    const totalUngraded = Object.values(stats).reduce((a, s) => a + s.ungraded, 0);
    // 35,263 of 37,173 are gradable offline (brief §5.7); the other 1,910 are free response.
    expect(totalCorrect + totalUngraded).toBe(37173);
    expect(totalUngraded).toBe(1910);
    expect(cycles).toBeGreaterThan(70000);
    // Every family is exercised.
    const families = new Set(Object.keys(stats).map((t) => FAMILY[t as TypeId]));
    expect(families.size).toBe(7);
  });

  it('finds exactly the 1,159 minimal pairs whose spoken text is notation (F24)', () => {
    const pairs = units.flatMap(itemsOf).filter((i) => i.type_id === 'minimal_pair_discrimination');
    expect(pairs.length).toBe(1811);
    expect(pairs.filter((i) => i.say && notationKind(i.say)).length).toBe(1159);
  });

  it('resolves every instruction key (brief §5.3)', async () => {
    const course = await repo.loadCourse();
    const missing = units
      .flatMap(itemsOf)
      .filter((i) => !(i.instruction_key in course.instructions))
      .map((i) => i.instruction_key);
    expect([...new Set(missing)]).toEqual([]);
    for (const [, [en]] of Object.entries(course.instructions)) {
      // docs/07 §3.1: no instruction longer than 12 words.
      expect(en.split(/\s+/).length).toBeLessThanOrEqual(12);
    }
  });

  it('meets the asserted course figures (brief §2.1)', async () => {
    const checks = await repo.startupChecks();
    expect(checks).toMatchObject({ units: 168, nodes: 1344, populatedTiers: 3019, items: 37173, instructionKeys: 31, ok: true });
  });
});
