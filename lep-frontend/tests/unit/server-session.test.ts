import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PROFILE, EXCLUDED_WITHOUT_AUDIO } from '@/a11y/profile';
import { api } from '@/api/client';
import { requestNodeSession } from '@/api/queries/sessions';
import type { SessionOut } from '@/api/types';
import type { Unit } from '@/content/model';
import { ContentRepository } from '@/content/repository';
import type { Item } from '@/content/schemas';
import { PRODUCTION_TYPES, withholdReason } from '@/runner/compose';
import type { Step } from '@/runner/phases';
import { TIER3_SPACING_MS, deviceGate, fromServerPlan, planUnitIds } from '@/runner/serverSession';

import { fsContentSource } from '../support/fsSource';

/**
 * A server-composed session (POST /v1/sessions) becomes runner steps without the app re-deciding
 * what or in which order: the server's order and phases are kept, new words are presented before
 * the first lesson item, what the server withheld for the profile is counted, its recovery items
 * travel with the session, and the server's id travels with the answers.
 */

const repo = new ContentRepository(fsContentSource);
let unit1: Unit;
let unit2: Unit;

beforeAll(async () => {
  unit1 = await repo.loadUnit('S01U01');
  unit2 = await repo.loadUnit('S01U02');
});

type PlanStep = SessionOut['steps'][number];

const PHASE_OF: Record<PlanStep['role'], PlanStep['phase']> = {
  warmup: 'warmup',
  review: 'review',
  lesson: 'guided',
  close: 'close',
  break: 'break',
  recovery: 'integration',
};

const step = (role: PlanStep['role'], id: string, unitId: string, phase = PHASE_OF[role]): PlanStep => ({
  role,
  phase,
  seconds: 9,
  item_id: id,
  type_id: 'x',
  unit_id: unitId,
  node_id: null,
  tier: 1,
  memory_item_id: null,
  target: null,
  modality: null,
  new_targets: [],
});

function plan(over: Partial<SessionOut> = {}): SessionOut {
  const node = unit2.nodes.find((n) => n.id === 'S01U02N1');
  const lesson = (node?.tiers[1] ?? []).slice(0, 6);
  const reviewItems = (unit1.nodes[0]?.tiers[1] ?? []).slice(0, 3);
  return {
    id: '01a1-server-session',
    kind: 'node',
    status: 'open',
    minutes: 12,
    node_id: 'S01U02N1',
    tier: 1,
    created_at: '2026-10-04T10:00:00Z',
    completed_at: null,
    estimated_seconds: 300,
    steps: [
      step('warmup', reviewItems[0]?.id ?? '', 'S01U01'),
      step('review', reviewItems[1]?.id ?? '', 'S01U01'),
      ...lesson.map((it) => step('lesson', it.id, 'S01U02')),
      { ...step('break', '', ''), item_id: null, unit_id: null },
      step('close', reviewItems[2]?.id ?? '', 'S01U01'),
    ],
    new_targets: [],
    deferred: [],
    catching_up: null,
    new_today: null,
    new_cap: null,
    recovery: [],
    withheld: [],
    a11y_profile: { no_audio: false, no_vision: false },
    ...over,
  };
}

const units = () => new Map([[unit1.id, unit1], [unit2.id, unit2]]);
const itemPhases = (steps: readonly Step[]) => steps.flatMap((s) => (s.kind === 'item' ? [s.phase] : []));
const allItems = (): Item[] => [unit1, unit2].flatMap((u) => u.nodes.flatMap((n) => Object.values(n.tiers).flatMap((items) => items ?? [])));
/** An item the plan does not hold, which the device shows to everyone (a recovery candidate). */
const unplanned = (p: SessionOut, n = 0): Item => {
  const planned = new Set(p.steps.map((s) => s.item_id));
  const it = allItems().filter((x) => !planned.has(x.id) && !withholdReason(x, { noAudio: true, noVision: true }))[n];
  if (!it) throw new Error('no unplanned item');
  return it;
};
/** A sound-only item the plan does not hold: no form without audio, on the server or the device. */
const soundOnly = (p: SessionOut): Item => {
  const planned = new Set(p.steps.map((s) => s.item_id));
  const it = allItems().find((x) => !planned.has(x.id) && EXCLUDED_WITHOUT_AUDIO.has(x.type_id));
  if (!it) throw new Error('no sound-only item in S01U01–S01U02');
  return it;
};

describe('fromServerPlan', () => {
  it('keeps the server order, presents before the first lesson item, and carries the server id', () => {
    const p = plan();
    const session = fromServerPlan(p, new Map([[unit1.id, unit1], [unit2.id, unit2]]), { profile: DEFAULT_PROFILE });
    expect(session).not.toBeNull();
    if (!session) return;
    expect(session.serverId).toBe(p.id);
    expect(session.nodeId).toBe('S01U02N1');
    expect(session.unitId).toBe('S01U02');
    const kinds = session.steps.map((s) => (s.kind === 'item' ? s.phase : s.kind));
    expect(kinds[0]).toBe('warmup');
    expect(kinds[1]).toBe('review');
    // NEW INPUT cards sit just before the first lesson item, never after it
    const firstLesson = session.steps.findIndex((s) => s.kind === 'item' && s.phase !== 'warmup' && s.phase !== 'review');
    const presents = session.steps.flatMap((s, i) => (s.kind === 'present' ? [i] : []));
    expect(presents.length).toBeGreaterThan(0);
    expect(Math.max(...presents)).toBeLessThan(firstLesson);
    expect(Math.min(...presents)).toBeGreaterThan(1);
    // the server's break is dropped (the runner times its own), the close item is a review
    expect(session.steps.some((s) => s.kind === 'break')).toBe(false);
    expect(session.steps.at(-1)).toEqual({ kind: 'close' });
    const last = session.steps.at(-2);
    expect(last?.kind === 'item' && last.phase).toBe('review');
    // item order is the server's, untouched
    const shownIds = session.steps.flatMap((s) => (s.kind === 'item' ? [s.item.id] : []));
    const planned = p.steps.flatMap((s) => (s.item_id ? [s.item_id] : []));
    expect(shownIds).toEqual(planned.filter((id) => shownIds.includes(id)));
  });

  it('returns null when none of the items are in this device content', () => {
    const p = plan({ steps: plan().steps.map((s) => ({ ...s, item_id: s.item_id ? 'item.9999999' : null })) });
    expect(fromServerPlan(p, new Map([[unit2.id, unit2]]), { profile: DEFAULT_PROFILE })).toBeNull();
  });

  it('withholds what the device cannot present for this learner, and counts it', () => {
    const p = plan();
    const session = fromServerPlan(p, new Map([[unit1.id, unit1], [unit2.id, unit2]]), { profile: { noAudio: true, noVision: false } });
    expect(session).not.toBeNull();
    const audioTypes = session?.withheld.length ?? 0;
    const shown = session?.steps.filter((s) => s.kind === 'item').length ?? 0;
    expect(audioTypes + shown).toBe(p.steps.filter((s) => s.item_id).length);
  });

  it("returns null when the node-tier's own lesson items are not all on this device", () => {
    // a newer content version: the reviews resolve, the lesson does not — no review-only "lesson"
    const p = plan({ steps: plan().steps.map((s) => (s.role === 'lesson' ? { ...s, item_id: 'item.9999999' } : s)) });
    expect(fromServerPlan(p, new Map([[unit1.id, unit1], [unit2.id, unit2]]), { profile: DEFAULT_PROFILE })).toBeNull();
  });

  it('lists the units a plan needs, only those this app packs', () => {
    expect(planUnitIds(plan()).sort()).toEqual(['S01U01', 'S01U02']);
    expect(planUnitIds(plan(), (id) => id === 'S01U02')).toEqual(['S01U02']);
    // a recovery item's unit is loaded too
    expect(planUnitIds(plan({ recovery: [step('recovery', 'item.0000001', 'S01U03')] })).sort()).toEqual(['S01U01', 'S01U02', 'S01U03']);
  });

  it('keeps the phase the server gave each item; the close item is a review', () => {
    // a split the device would never compute: guided and integration alternate
    let lessonIndex = 0;
    const p = plan({
      steps: plan().steps.map((s) => (s.role === 'lesson' ? { ...s, phase: lessonIndex++ % 2 ? 'integration' : 'guided' } : s)),
    });
    const session = fromServerPlan(p, units(), { profile: DEFAULT_PROFILE });
    if (!session) throw new Error('no session');
    // (an item the device withholds itself — a stress pattern that does not spell the word — is not shown)
    const shown = new Set(session.steps.flatMap((s) => (s.kind === 'item' ? [s.item.id] : [])));
    const expected = p.steps.flatMap((s) => (s.item_id && shown.has(s.item_id) ? [s.phase === 'close' ? 'review' : s.phase] : []));
    expect(itemPhases(session.steps)).toEqual(expected);
    expect(itemPhases(session.steps)).toContain('integration');
  });

  it('reckons the phases itself for a plan from an older server (no phase, no recovery, no withheld)', () => {
    const { recovery: _r, withheld: _w, a11y_profile: _a, ...rest } = plan();
    const old = { ...rest, steps: rest.steps.map(({ phase: _p, ...s }) => s) } as unknown as SessionOut;
    const session = fromServerPlan(old, units(), { profile: DEFAULT_PROFILE });
    if (!session) throw new Error('no session');
    const phases = itemPhases(session.steps);
    expect(phases[0]).toBe('warmup');
    expect(phases[1]).toBe('review');
    expect(phases.at(-1)).toBe('review');
    const lesson = session.steps.flatMap((s) => (s.kind === 'item' && s.phase !== 'warmup' && s.phase !== 'review' ? [s] : []));
    const practice = lesson.filter((s) => !PRODUCTION_TYPES.has(s.item.type_id));
    const guided = Math.ceil(practice.length * 0.6);
    expect(practice.map((s) => s.phase)).toEqual(practice.map((_, i) => (i < guided ? 'guided' : 'integration')));
    expect(lesson.filter((s) => PRODUCTION_TYPES.has(s.item.type_id)).every((s) => s.phase === 'production')).toBe(true);
    expect(session.withheld.some((w) => w.reason === 'profile')).toBe(false);
    expect(session.recovery).toEqual([]);
  });

  it('counts what the server withheld for the profile, once, and only what this device has', () => {
    const base = plan();
    const sound = soundOnly(base);
    const extra = unplanned(base);
    // the sound-only item is in the plan as a review too: the device withholds it itself
    const p = plan({
      steps: [...base.steps.slice(0, -1), step('review', sound.id, sound.unit), ...base.steps.slice(-1)],
      withheld: [extra.id, sound.id, 'item.not-on-this-device'],
      a11y_profile: { no_audio: true, no_vision: false },
    });
    const session = fromServerPlan(p, units(), { profile: { noAudio: true, noVision: false } });
    if (!session) throw new Error('no session');
    expect(session.withheld).toContainEqual({ itemId: extra.id, reason: 'profile' });
    expect(session.withheld.filter((w) => w.itemId === sound.id)).toHaveLength(1);
    expect(session.withheld.some((w) => w.itemId === 'item.not-on-this-device')).toBe(false);
    // nothing withheld is played
    const shown = new Set(session.steps.flatMap((s) => (s.kind === 'item' ? [s.item.id] : [])));
    expect(session.withheld.some((w) => shown.has(w.itemId))).toBe(false);
  });

  it("carries the server's recovery items this device can show, in its order", () => {
    const base = plan();
    const sure = unplanned(base);
    const sound = soundOnly(base);
    const p = plan({
      recovery: [step('recovery', sure.id, sure.unit), step('recovery', 'item.not-on-this-device', 'S01U01'), step('recovery', sound.id, sound.unit)],
    });
    expect(fromServerPlan(p, units(), { profile: DEFAULT_PROFILE })?.recovery?.map((it) => it.id)).toEqual(
      withholdReason(sound, DEFAULT_PROFILE) ? [sure.id] : [sure.id, sound.id],
    );
    // without audio the sound-only item has no form: only the other one travels
    expect(fromServerPlan(p, units(), { profile: { noAudio: true, noVision: false } })?.recovery?.map((it) => it.id)).toEqual([sure.id]);
    // recovery items are never part of the plan's own steps
    const session = fromServerPlan(p, units(), { profile: DEFAULT_PROFILE });
    expect(session?.steps.some((s) => s.kind === 'item' && s.item.id === sure.id)).toBe(false);
  });
});

describe('requestNodeSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names this device's accessibility profile in the request", async () => {
    const p = plan();
    const post = vi.spyOn(api, 'POST').mockResolvedValue({ data: p, error: undefined, response: { ok: true, status: 201, headers: new Headers() } as Response } as never);
    const result = await requestNodeSession('S01U02N1', 1, 12.4, { noAudio: true, noVision: false });
    expect(result).toEqual({ kind: 'plan', plan: p });
    expect(post).toHaveBeenCalledWith('/v1/sessions', {
      body: { minutes: 12, node_id: 'S01U02N1', tier: 1, a11y_profile: { no_audio: true, no_vision: false } },
    });
  });

  it('an older server that refuses the profile field leaves the lesson to the device', async () => {
    // pydantic's extra="forbid" on the pre-F19 SessionRequest
    vi.spyOn(api, 'POST').mockResolvedValue({
      data: undefined,
      error: { type: 'validation_error', title: 'Unprocessable', status: 422 },
      response: { ok: false, status: 422, headers: new Headers() } as Response,
    } as never);
    const result = await requestNodeSession('S01U02N1', 1, 12, DEFAULT_PROFILE);
    expect(result.kind).toBe('unavailable');
  });
});

describe('deviceGate', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();

  it('opens a tier this device just finished the one before (its answers may be in the outbox)', () => {
    expect(deviceGate({ 1: ago(1) }, 2, now)).toEqual({ kind: 'open' });
  });

  it("does not stand in for the server once the device's record is old", () => {
    expect(deviceGate({ 1: ago(30) }, 2, now)).toEqual({ kind: 'previous_tier' });
    expect(deviceGate({}, 2, now)).toEqual({ kind: 'previous_tier' });
  });

  it('keeps tier 3 three days after tier 2', () => {
    expect(deviceGate({ 2: ago(1) }, 3, now)).toEqual({ kind: 'spaced', availableAt: new Date(now - 3_600_000 + TIER3_SPACING_MS).toISOString() });
  });
});
