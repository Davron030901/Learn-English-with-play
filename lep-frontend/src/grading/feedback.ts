import { l1Feedback } from '@/content/l1';
import type { Unit } from '@/content/model';
import type { Item } from '@/content/schemas';

import type { GradeResult } from './grade';

/**
 * What the feedback sheet says (brief §5.5), assembled in the brief's order:
 *   1. correct / not correct — the sheet's title, chosen by the UI from `verdict`;
 *   2. the expected answer;
 *   3. `feedback.correct`, or the matched `rejected_with_feedback[].feedback`, falling back to
 *      `feedback.incorrect_default` — in that order;
 *   4. `feedback.explain_ref` resolved to the unit's grammar or phonology point;
 *   5. the L1 note, only when the learner made exactly the error it describes (brief §14);
 *   6. "I think my answer was right" — always; the sheet renders it unconditionally.
 * Nothing is padded (content defect C9: 11,811 items carry no why).
 */

export interface FeedbackContent {
  verdict: GradeResult['verdict'];
  expected: string | null;
  why: string | null;
  /** docs/07 §6.1 error code, as a label. Never "GRAM" (content defect C8 / S23). */
  diagnosis: ErrorCode | null;
  explainRef: { kind: 'grammar' | 'phonology'; id: string; label: string } | null;
  l1Note: string | null;
  typo: GradeResult['typo'];
  timeout: boolean;
}

export const ERROR_CODES = ['ART', 'TNS', 'PREP', 'WO', 'L1', 'SV', 'WF', 'WW', 'SP', 'PL', 'AUX', 'NEG', 'Q', 'COLL', 'REG'] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

function asDiagnosis(code: string | undefined): ErrorCode | null {
  if (!code) return null;
  const up = code.toUpperCase();
  return (ERROR_CODES as readonly string[]).includes(up) ? (up as ErrorCode) : null;
}

export function feedbackContent(
  item: Item,
  result: GradeResult,
  unit: Unit | undefined,
  l1: string,
  english: ReadonlySet<string>,
): FeedbackContent {
  const lexemes = unit?.lexemes ?? [];
  const localise = (s: string | undefined) => l1Feedback(s, l1, item, lexemes, english);

  let why: string | null = null;
  if (result.verdict === 'correct') {
    why = localise(item.feedback.correct);
  } else if (result.verdict === 'incorrect') {
    why = localise(result.rejected?.feedback) ?? localise(item.feedback.incorrect_default);
  } else {
    why = localise(item.feedback.correct);
  }

  let explainRef: FeedbackContent['explainRef'] = null;
  const ref = item.feedback.explain_ref;
  if (ref && unit) {
    const g = unit.grammar.find((p) => p.id === ref);
    const p = unit.phonology.find((q) => q.id === ref);
    if (g) explainRef = { kind: 'grammar', id: g.id, label: g.label };
    else if (p) explainRef = { kind: 'phonology', id: p.id, label: p.label };
  }

  // The L1 note of a grammar point, shown only when the answer reproduced the known L1 error
  // (the rejected pattern matched). Shown pre-emptively it would teach the error (brief §14).
  let l1Note: string | null = null;
  if (result.rejected && unit) {
    const gid = item.targets.grammar?.[0] ?? (explainRef?.kind === 'grammar' ? explainRef.id : undefined);
    const g = gid ? unit.grammar.find((p) => p.id === gid) : undefined;
    l1Note = g?.l1_notes[l1] ?? null;
  }

  return {
    verdict: result.verdict,
    expected: result.verdict === 'correct' ? null : result.expected,
    why,
    diagnosis: result.verdict === 'incorrect' ? asDiagnosis(result.rejected?.errorCode) : null,
    explainRef,
    l1Note,
    typo: result.typo,
    timeout: result.reason === 'timeout',
  };
}
