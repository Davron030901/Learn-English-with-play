import type { Course, Tier, Unit } from '@/content/model';
import type { Item } from '@/content/schemas';
import { unitIdOfNode } from '@/features/path/position';
import { joinTiles, type GradeContext, type Submission } from '@/grading/grade';
import type { Hint } from '@/grading/hints';
import type { SubmissionRecord } from '@/outbox/outbox';

/**
 * Pure helpers for the lesson runner, kept out of the component so they are tested without
 * React (tests/unit/lesson-record.test.ts).
 */

/** What the grader needs besides the item: the word list and the item's own targets. */
export function gradeContextFor(item: Item, unit: Unit | undefined, words: ReadonlySet<string>): GradeContext {
  if (!unit) return { words };
  const targetLemmas = (item.targets.lexis ?? [])
    .map((id) => unit.lexemes.find((l) => l.id === id)?.lemma)
    .filter((x): x is string => typeof x === 'string');
  const functionExponents = (item.targets.functions ?? []).flatMap(
    (id) => unit.functions.find((f) => f.id === id)?.exponents.map((e) => e.text) ?? [],
  );
  return { words, targetLemmas, functionExponents };
}

/**
 * The submission as it is stored in the outbox. A copy, never the renderer's object, and for bank
 * items the tiles are also joined into the text the learner built — the server grades that text.
 * A recording is never part of it: recordings stay on the device (brief §0, docs/06 §4.5).
 */
export function toSubmissionRecord(item: Item, sub: Submission): SubmissionRecord {
  switch (sub.kind) {
    case 'choice':
      return { kind: 'choice', index: sub.index };
    case 'text':
      return { kind: 'text', text: sub.text };
    case 'tiles': {
      const bank = item.type_id === 'word_bank_build' || item.type_id === 'sentence_reorder' ? item.prompt.bank : [];
      return { kind: 'tiles', indices: [...sub.indices], text: joinTiles(sub.indices.map((i) => bank[i] ?? '')) };
    }
    case 'order':
      return { kind: 'order', indices: [...sub.indices] };
    case 'pairs':
      return {
        kind: 'pairs',
        matches: sub.matches.map(([l, r]) => [l, r] as [number, number]),
        mistakes: sub.mistakes,
        complete: sub.complete,
        ...(sub.attempts ? { attempts: sub.attempts.map(([l, r]) => [l, r] as [number, number]) } : {}),
        ...(sub.timedOut ? { timed_out: true } : {}),
      };
    case 'bins':
      return { kind: 'bins', assignment: { ...sub.assignment } };
    case 'speech':
      return sub.modality === 'typed' ? { kind: 'speech', modality: 'typed', text: sub.text ?? '' } : { kind: 'speech', modality: 'voice' };
    case 'timeout':
      return { kind: 'timeout' };
  }
}

export interface NextLesson {
  nodeId: string;
  tier: Tier;
  title: string;
  unitIndex: number;
}

/**
 * "Next lesson" from the close screen, in path order: the next unfinished tier of this node,
 * then the first unfinished tier of the following lesson, story or speak node. Immersion and
 * review nodes carry no items (content defect C18) and are skipped, as the path's Continue does.
 */
export function nextAfter(course: Course, nodeId: string, tier: Tier, completed: ReadonlyMap<string, readonly Tier[]>): NextLesson | null {
  const unit = course.unitsById.get(unitIdOfNode(nodeId));
  const node = unit?.nodes.find((n) => n.id === nodeId);
  if (unit && node) {
    const done = completed.get(nodeId) ?? [];
    // tier 3 opens three days after tier 2 (docs/08 §4.3): not "next" right after it
    const later = node.populatedTiers.find((x) => x > tier && !done.includes(x) && !(tier === 2 && x === 3));
    if (later) return { nodeId, tier: later, title: node.title, unitIndex: unit.index };
  }
  let found = false;
  for (const s of course.sections) {
    for (const u of s.units) {
      for (const n of u.nodes) {
        if (found && (n.kind === 'lesson' || n.kind === 'story' || n.kind === 'speak')) {
          const done = completed.get(n.id) ?? [];
          const next = n.populatedTiers.find((x) => !done.includes(x));
          if (next) return { nodeId: n.id, tier: next, title: n.title, unitIndex: u.index };
        }
        if (n.id === nodeId) found = true;
      }
    }
  }
  return null;
}

/** The completion map with one more finished node-tier — the state right after CLOSE. */
export function withCompleted(map: ReadonlyMap<string, readonly Tier[]>, nodeId: string, tier: Tier): Map<string, Tier[]> {
  const next = new Map<string, Tier[]>();
  for (const [k, v] of map) next.set(k, [...v]);
  const cur = next.get(nodeId) ?? [];
  if (!cur.includes(tier)) next.set(nodeId, [...cur, tier]);
  return next;
}

/** The i18n key and values for a derived hint (DECISIONS F18). */
export function hintMessage(hint: Hint): { key: string; values: Record<string, string> } {
  switch (hint.kind) {
    case 'first_letter':
      return { key: 'lesson.hintFirstLetter', values: { letter: hint.letter } };
    case 'look_at':
      return { key: 'lesson.hintLookAt', values: { span: hint.span } };
    case 'missing_after':
      return { key: 'lesson.hintMissingAfter', values: { word: hint.word } };
    case 'missing_before':
      return { key: 'lesson.hintMissingBefore', values: { word: hint.word } };
  }
}
