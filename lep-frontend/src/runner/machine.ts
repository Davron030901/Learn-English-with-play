import type { Item } from '@/content/schemas';
import { FAMILY, type GradeResult, type Submission } from '@/grading/grade';

import { BREAK_AFTER_MS, type Phase, type Step } from './phases';

/**
 * The lesson runner as an explicit state machine (brief §3, §6). A pure reducer: grading,
 * audio and the outbox happen outside it, and it is tested without React.
 *
 *   present ──got it──▶ next step
 *   answering ──submit──▶ feedback ──continue──▶ next step
 *   (elapsed > 12 min, once) ──▶ break ──end──▶ next step
 *   … last step is close; a wrong answer right before close inserts one recovery item first
 *   quit at any time ──▶ ended (stopping is always one tap and never punished, docs/07 §3.3)
 */

export type RunnerStatus = 'present' | 'answering' | 'feedback' | 'break' | 'close' | 'ended';

export interface AnswerRecord {
  stepIndex: number;
  itemId: string;
  phase: Phase;
  clientUuid: string;
  verdict: GradeResult['verdict'];
  recovery: boolean;
  hintsUsed: number;
  playsUsed: number;
  rtMs: number;
}

export interface RunnerState {
  steps: Step[];
  index: number;
  status: RunnerStatus;
  startedAt: number;
  stepStartedAt: number;
  plays: number;
  hints: number;
  answers: AnswerRecord[];
  lastResult: GradeResult | null;
  breakTaken: boolean;
  /** The server's near-certain items for the recovery step, in its order (none offline). */
  recovery: readonly Item[];
  recoveryInserted: boolean;
  /** Why the session ended: completed through close, or left early. */
  ending: 'completed' | 'left' | null;
}

export type RunnerAction =
  | { type: 'got_it'; now: number }
  | { type: 'played' }
  | { type: 'hint_used' }
  | {
      type: 'submitted';
      now: number;
      submission: Submission;
      result: GradeResult;
      clientUuid: string;
    }
  | { type: 'continue'; now: number }
  | { type: 'break_done'; now: number }
  | { type: 'finish'; now: number }
  | { type: 'quit'; now: number };

function statusFor(step: Step | undefined): RunnerStatus {
  if (!step) return 'ended';
  switch (step.kind) {
    case 'present':
      return 'present';
    case 'item':
      return 'answering';
    case 'break':
      return 'break';
    case 'close':
      return 'close';
  }
}

export function initialState(steps: Step[], now: number, opts: { recovery?: readonly Item[] } = {}): RunnerState {
  if (steps.length === 0 || steps[steps.length - 1]?.kind !== 'close') {
    throw new Error('a session must end with a close step');
  }
  return {
    steps,
    index: 0,
    status: statusFor(steps[0]),
    startedAt: now,
    stepStartedAt: now,
    plays: 0,
    hints: 0,
    answers: [],
    lastResult: null,
    breakTaken: false,
    recovery: opts.recovery ?? [],
    recoveryInserted: false,
    ending: null,
  };
}

/** Reaction time as reported to the server: clamped to [250 ms, 120 s] (brief §5.7). */
export function clampRt(ms: number): number {
  return Math.min(120_000, Math.max(250, Math.round(ms)));
}

/**
 * The item to play so a session never ends on a failure (brief §6.1): the first of the server's
 * near-certain items not yet answered in this session (DECISIONS F19); without one, an item the
 * learner already answered correctly in this session (a recognition item first), else the most
 * recent failed recognition item — its answer was just shown on the feedback sheet.
 */
function pickRecovery(state: RunnerState): Step | null {
  const answered = new Set(state.answers.map((a) => a.itemId));
  const sure = state.recovery.find((it) => !answered.has(it.id));
  if (sure) return { kind: 'item', phase: 'integration', item: sure, recovery: true };
  const itemSteps = state.answers
    .map((a) => ({ a, step: state.steps[a.stepIndex] }))
    .filter((x): x is { a: AnswerRecord; step: Extract<Step, { kind: 'item' }> } => x.step?.kind === 'item');
  const recognition = (s: Extract<Step, { kind: 'item' }>) => FAMILY[s.item.type_id] === 'choice';
  const pick =
    itemSteps.find((x) => x.a.verdict === 'correct' && recognition(x.step)) ??
    itemSteps.find((x) => x.a.verdict === 'correct' && FAMILY[x.step.item.type_id] !== 'speak') ??
    [...itemSteps].reverse().find((x) => x.a.verdict === 'incorrect' && recognition(x.step));
  if (!pick) return null;
  return { kind: 'item', phase: 'integration', item: pick.step.item, recovery: true };
}

function advance(state: RunnerState, now: number): RunnerState {
  let steps = state.steps;
  let next = state.index + 1;
  let { recoveryInserted, breakTaken } = state;

  // Never close on a failure: one recovery item before CLOSE when the last graded answer was wrong.
  if (steps[next]?.kind === 'close' && !recoveryInserted && state.lastResult?.verdict === 'incorrect') {
    const recovery = pickRecovery(state);
    if (recovery) {
      steps = [...steps.slice(0, next), recovery, ...steps.slice(next)];
      recoveryInserted = true;
    }
  }

  // A 15-second break once the session passes 12 minutes, never in the middle of an item.
  if (!breakTaken && now - state.startedAt > BREAK_AFTER_MS && steps[next]?.kind !== 'close') {
    steps = [...steps.slice(0, next), { kind: 'break' }, ...steps.slice(next)];
    breakTaken = true;
  }

  return {
    ...state,
    steps,
    index: next,
    status: statusFor(steps[next]),
    stepStartedAt: now,
    plays: 0,
    hints: 0,
    recoveryInserted,
    breakTaken,
  };
}

export function reducer(state: RunnerState, action: RunnerAction): RunnerState {
  if (state.status === 'ended') return state;
  switch (action.type) {
    case 'quit':
      return { ...state, status: 'ended', ending: 'left' };

    case 'got_it':
      return state.status === 'present' ? advance(state, action.now) : state;

    case 'played':
      return state.status === 'answering' ? { ...state, plays: state.plays + 1 } : state;

    case 'hint_used':
      return state.status === 'answering' ? { ...state, hints: state.hints + 1 } : state;

    case 'submitted': {
      if (state.status !== 'answering') return state;
      const step = state.steps[state.index];
      if (step?.kind !== 'item') return state;
      const record: AnswerRecord = {
        stepIndex: state.index,
        itemId: step.item.id,
        phase: step.phase,
        clientUuid: action.clientUuid,
        verdict: action.result.verdict,
        recovery: step.recovery ?? false,
        hintsUsed: state.hints,
        playsUsed: state.plays,
        rtMs: clampRt(action.now - state.stepStartedAt),
      };
      return {
        ...state,
        status: 'feedback',
        answers: [...state.answers, record],
        // Ungraded answers (speech, free writing) neither fail nor pass the close rule.
        lastResult: action.result.verdict === 'ungraded' ? state.lastResult : action.result,
      };
    }

    case 'continue':
      return state.status === 'feedback' ? advance(state, action.now) : state;

    case 'break_done':
      return state.status === 'break' ? advance(state, action.now) : state;

    case 'finish':
      return state.status === 'close' ? { ...state, status: 'ended', ending: 'completed' } : state;
  }
}

export function currentStep(state: RunnerState): Step | undefined {
  return state.steps[state.index];
}

/** Progress for the lesson header: share of steps done (the close step excluded). */
export function progress(state: RunnerState): number {
  const total = Math.max(1, state.steps.length - 1);
  return Math.min(1, state.index / total);
}
