import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_PROFILE } from '@/a11y/profile';
import type { Tier, Unit } from '@/content/model';
import { ContentRepository } from '@/content/repository';
import type { GradeResult } from '@/grading/grade';
import { PRODUCTION_TYPES, composeNodeSession, composePracticeSession, parseSessionId, sessionIdFor, withholdReason } from '@/runner/compose';
import { clampRt, currentStep, initialState, progress, reducer, type RunnerState } from '@/runner/machine';
import { BREAK_AFTER_MS, PHASES, type Step } from '@/runner/phases';

import { fsContentSource } from '../support/fsSource';
import { makeItem } from '../support/items';

const choice = (id: string) => makeItem('mcq_word_from_definition', { text_uz: 'x', options: ['a', 'b'] }, { index: 0 }, { id });
const text = (id: string) => makeItem('dictation_word', { audio: 'a.mp3' }, { key: ['house'] }, { id });
const speak = (id: string) => makeItem('speak_prompt', { text: 'Greet someone.' }, { key: [] }, { id });

const correct: GradeResult = { verdict: 'correct', expected: null, typo: null, rejected: null, reason: null };
const wrong: GradeResult = { verdict: 'incorrect', expected: 'house', typo: null, rejected: null, reason: null };
const ungraded: GradeResult = { verdict: 'ungraded', expected: null, typo: null, rejected: null, reason: 'voice' };

function answer(s: RunnerState, result: GradeResult, now: number): RunnerState {
  const a = reducer(s, { type: 'submitted', now, submission: { kind: 'choice', index: 0 }, result, clientUuid: `u${now}` });
  return reducer(a, { type: 'continue', now: now + 1 });
}

describe('runner state machine (brief §6)', () => {
  it('refuses a session that does not end on CLOSE', () => {
    expect(() => initialState([{ kind: 'item', phase: 'guided', item: choice('i1') }], 0)).toThrow();
  });

  it('present → got it; answering → feedback → continue; close → finish', () => {
    const steps: Step[] = [
      { kind: 'present', phase: 'new_input', card: { type: 'grammar', point: { id: 'G-1', label: 'be', form: 'am', meaning: 'm', explanation: { en: 'e' }, positive_example: 'I am', negative_example: 'I is', l1_notes: {} } } },
      { kind: 'item', phase: 'guided', item: choice('i1') },
      { kind: 'close' },
    ];
    let s = initialState(steps, 1000);
    expect(s.status).toBe('present');
    // Nothing can be submitted while presenting: NEW INPUT is never a test.
    expect(reducer(s, { type: 'submitted', now: 1, submission: { kind: 'choice', index: 0 }, result: correct, clientUuid: 'x' })).toBe(s);
    s = reducer(s, { type: 'got_it', now: 2000 });
    expect(s.status).toBe('answering');
    s = reducer(s, { type: 'played' });
    s = reducer(s, { type: 'hint_used' });
    s = reducer(s, { type: 'submitted', now: 2600, submission: { kind: 'choice', index: 0 }, result: correct, clientUuid: 'c1' });
    expect(s.status).toBe('feedback');
    expect(s.answers[0]).toMatchObject({ itemId: 'i1', clientUuid: 'c1', verdict: 'correct', hintsUsed: 1, playsUsed: 1, rtMs: 600 });
    // A second submit of the same item is ignored.
    expect(reducer(s, { type: 'submitted', now: 2700, submission: { kind: 'choice', index: 1 }, result: wrong, clientUuid: 'c2' }).answers).toHaveLength(1);
    s = reducer(s, { type: 'continue', now: 3000 });
    expect(s.status).toBe('close');
    expect(progress(s)).toBe(1);
    s = reducer(s, { type: 'finish', now: 3100 });
    expect(s).toMatchObject({ status: 'ended', ending: 'completed' });
  });

  it('never closes on a failure: one recovery item is inserted before CLOSE', () => {
    let s = initialState([{ kind: 'item', phase: 'guided', item: choice('easy') }, { kind: 'item', phase: 'integration', item: text('hard') }, { kind: 'close' }], 0);
    s = answer(s, correct, 10);
    s = answer(s, wrong, 20);
    const step = currentStep(s);
    expect(step).toMatchObject({ kind: 'item', recovery: true });
    expect(step?.kind === 'item' && step.item.id).toBe('easy');
    s = answer(s, correct, 30);
    expect(s.status).toBe('close');
    expect(s.recoveryInserted).toBe(true);
  });

  it("plays the server's near-certain item before CLOSE after a wrong last answer", () => {
    const steps: Step[] = [{ kind: 'item', phase: 'guided', item: choice('easy') }, { kind: 'item', phase: 'integration', item: text('hard') }, { kind: 'close' }];
    let s = initialState(steps, 0, { recovery: [choice('sure-1'), choice('sure-2')] });
    s = answer(s, correct, 10);
    s = answer(s, wrong, 20);
    const step = currentStep(s);
    expect(step).toMatchObject({ kind: 'item', phase: 'integration', recovery: true });
    expect(step?.kind === 'item' && step.item.id).toBe('sure-1');
    s = answer(s, correct, 30);
    expect(s.answers.at(-1)).toMatchObject({ itemId: 'sure-1', recovery: true });
    expect(s.status).toBe('close');
    // one recovery item, never a second
    expect(s.steps.filter((x) => x.kind === 'item' && x.recovery)).toHaveLength(1);
  });

  it("passes over a server recovery item already answered in this session, and falls back without one", () => {
    const steps: Step[] = [{ kind: 'item', phase: 'guided', item: choice('a') }, { kind: 'item', phase: 'integration', item: text('b') }, { kind: 'close' }];
    // the server's only candidate was just failed here: re-present the one answered correctly
    let s = initialState(steps, 0, { recovery: [text('b')] });
    s = answer(s, correct, 10);
    s = answer(s, wrong, 20);
    let step = currentStep(s);
    expect(step?.kind === 'item' && step.recovery && step.item.id).toBe('a');
    // the next unanswered candidate wins over the fallback
    s = initialState(steps, 0, { recovery: [text('b'), choice('c')] });
    s = answer(s, correct, 10);
    s = answer(s, wrong, 20);
    step = currentStep(s);
    expect(step?.kind === 'item' && step.recovery && step.item.id).toBe('c');
    // a right last answer needs no recovery at all
    s = initialState(steps, 0, { recovery: [choice('c')] });
    s = answer(s, correct, 10);
    s = answer(s, correct, 20);
    expect(s.status).toBe('close');
    expect(s.recoveryInserted).toBe(false);
  });

  it('ungraded answers neither fail nor pass the close rule', () => {
    let s = initialState([{ kind: 'item', phase: 'guided', item: choice('a') }, { kind: 'item', phase: 'production', item: speak('s') }, { kind: 'close' }], 0);
    s = answer(s, correct, 10);
    s = answer(s, ungraded, 20);
    expect(s.status).toBe('close');
    expect(s.recoveryInserted).toBe(false);
  });

  it('offers one 15-second break after 12 minutes, never twice and never right before CLOSE', () => {
    let s = initialState([{ kind: 'item', phase: 'guided', item: choice('a') }, { kind: 'item', phase: 'guided', item: choice('b') }, { kind: 'item', phase: 'guided', item: choice('c') }, { kind: 'close' }], 0);
    s = answer(s, correct, BREAK_AFTER_MS + 1);
    expect(s.status).toBe('break');
    s = reducer(s, { type: 'break_done', now: BREAK_AFTER_MS + 20_000 });
    expect(s.status).toBe('answering');
    s = answer(s, correct, BREAK_AFTER_MS + 30_000);
    expect(s.status).toBe('answering');
    expect(s.steps.filter((x) => x.kind === 'break')).toHaveLength(1);
  });

  it('quitting is always possible and ends the session as "left"', () => {
    const s = reducer(initialState([{ kind: 'item', phase: 'guided', item: choice('a') }, { kind: 'close' }], 0), { type: 'quit', now: 1 });
    expect(s).toMatchObject({ status: 'ended', ending: 'left' });
    expect(reducer(s, { type: 'got_it', now: 2 })).toBe(s);
  });

  it('clamps reaction time to [250 ms, 120 s]', () => {
    expect(clampRt(10)).toBe(250);
    expect(clampRt(1234.4)).toBe(1234);
    expect(clampRt(10 * 60_000)).toBe(120_000);
  });

  it('the session shape is the docs/07 §3.2 order', () => {
    expect(PHASES).toEqual(['warmup', 'review', 'new_input', 'guided', 'integration', 'production', 'close']);
  });
});

describe('local composition on real content (DECISIONS "Local composition")', () => {
  const repo = new ContentRepository(fsContentSource);
  let unit: Unit;
  beforeAll(async () => {
    unit = await repo.loadUnit('S01U01');
  });
  const opts = (completed: Map<string, Tier[]> = new Map(), seed = 7) => ({ profile: DEFAULT_PROFILE, completed, seed });

  it('session ids round-trip and reject anything else', () => {
    expect(sessionIdFor('S01U01N1', 2)).toBe('S01U01N1.t2');
    expect(parseSessionId('S01U01N1.t2')).toEqual({ nodeId: 'S01U01N1', tier: 2 });
    expect(parseSessionId('S01U01N1.t4')).toBeNull();
    expect(parseSessionId('../etc/passwd')).toBeNull();
  });

  it('presents before it tests, keeps build order, ends with production then CLOSE', () => {
    const s = composeNodeSession(unit, 'S01U01N1', 1, opts());
    const kinds = s.steps.map((x) => x.kind);
    const firstItem = kinds.indexOf('item');
    expect(kinds.lastIndexOf('present')).toBeLessThan(firstItem);
    expect(kinds.at(-1)).toBe('close');
    const items = s.steps.flatMap((x) => (x.kind === 'item' ? [x] : []));
    const firstProduction = items.findIndex((x) => x.phase === 'production');
    if (firstProduction >= 0) {
      expect(items.slice(firstProduction).every((x) => PRODUCTION_TYPES.has(x.item.type_id))).toBe(true);
    }
    const tier = unit.nodes.find((n) => n.id === 'S01U01N1')?.tiers[1] ?? [];
    const practice = tier.filter((it) => !PRODUCTION_TYPES.has(it.type_id) && !withholdReason(it, DEFAULT_PROFILE));
    expect(items.filter((x) => x.phase !== 'production').map((x) => x.item.id)).toEqual(practice.map((x) => x.id));
    expect(s.introduced.lexemes.length).toBeGreaterThan(0);
  });

  it('later tiers present nothing new, except the story node, which always shows the story', () => {
    const t2 = composeNodeSession(unit, 'S01U01N1', 2, opts());
    expect(t2.steps.some((x) => x.kind === 'present')).toBe(false);
    const story = composeNodeSession(unit, 'S01U01N4', 2, opts());
    expect(story.steps[0]).toMatchObject({ kind: 'present', card: { type: 'story' } });
  });

  it('warms up only from what this device finished earlier in the unit', () => {
    expect(composeNodeSession(unit, 'S01U01N2', 1, opts()).steps.some((x) => x.kind === 'item' && x.phase === 'warmup')).toBe(false);
    const warm = composeNodeSession(unit, 'S01U01N2', 1, opts(new Map([['S01U01N1', [1 as Tier]]])));
    const warmup = warm.steps.filter((x) => x.kind === 'item' && x.phase === 'warmup');
    expect(warmup.length).toBeGreaterThan(0);
    expect(warmup.every((x) => x.kind === 'item' && x.item.node === 'S01U01N1')).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const done = new Map([['S01U01N1', [1 as Tier, 2 as Tier]]]);
    const a = composeNodeSession(unit, 'S01U01N3', 1, opts(done, 42));
    const b = composeNodeSession(unit, 'S01U01N3', 1, opts(done, 42));
    expect(a.steps).toEqual(b.steps);
  });

  it('withholds what the device cannot present honestly, and counts it', () => {
    const noAudio = composeNodeSession(unit, 'S01U01N1', 1, { ...opts(), profile: { noAudio: true, noVision: false } });
    expect(noAudio.steps.some((x) => x.kind === 'item' && (x.item.type_id === 'minimal_pair_discrimination' || x.item.type_id === 'phoneme_id'))).toBe(false);
    expect(noAudio.withheld.every((w) => ['profile', 'notation_audio', 'bad_syllables'].includes(w.reason))).toBe(true);
  });

  it('practice mixes only finished node-tiers and never speaking or free writing', () => {
    expect(composePracticeSession([unit], new Map(), { profile: DEFAULT_PROFILE, seed: 1, size: 10 })).toBeNull();
    const p = composePracticeSession([unit], new Map([['S01U01N1', [1 as Tier]]]), { profile: DEFAULT_PROFILE, seed: 1, size: 10 });
    expect(p).not.toBeNull();
    const items = p?.steps.flatMap((x) => (x.kind === 'item' ? [x.item] : [])) ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(10);
    expect(items.every((i) => i.node === 'S01U01N1' && i.tier === 1)).toBe(true);
    expect(items.some((i) => PRODUCTION_TYPES.has(i.type_id))).toBe(false);
    expect(p?.steps.at(-1)).toEqual({ kind: 'close' });
  });
});
