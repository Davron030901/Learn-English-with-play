import type { AccessibilityProfile } from '@/a11y/profile';
import type { SessionOut } from '@/api/types';
import type { Tier, Unit } from '@/content/model';
import type { Item } from '@/content/schemas';

import { PRODUCTION_TYPES, presentCards, withholdReason, type ComposedSession } from './compose';
import type { Step } from './phases';

type ItemPhase = Extract<Step, { kind: 'item' }>['phase'];
type ServerPhase = SessionOut['steps'][number]['phase'];

/**
 * The server's phase for an item step (docs/07 §3.2). Its close item is a scheduler-chosen review,
 * as on the device; a phase no item can have (new_input, break) or a plan from a server that sends
 * none falls back to the app's own reckoning.
 */
const SERVER_PHASE: Partial<Record<ServerPhase, ItemPhase>> = {
  warmup: 'warmup',
  review: 'review',
  guided: 'guided',
  integration: 'integration',
  production: 'production',
  close: 'review',
};

/**
 * A session the server composed (POST /v1/sessions, docs/08 §5) turned into runner steps.
 *
 * The server decides *what* and in *which order*: warm-up, the due reviews, the node-tier's
 * items, the close — already interleaved (≤ 3 on one target, ≤ 2 of one type in a row). The app
 * only adds what is a matter of the screen:
 *   * NEW INPUT cards for the node's new words and grammar, shown just before the first lesson
 *     item — presented, never tested (docs/07 §3.2);
 *   * the runner's own 15-second break, timed by the real clock (the server's planned breaks
 *     are dropped so there are never two);
 *   * items this device cannot present honestly are withheld and counted, as in local sessions.
 *
 * Each item keeps the phase the server gave it (an older plan without phases gets the device's:
 * the first 60 % of the lesson's practice items guided, the rest integration, speaking and free
 * writing production). The lesson items the learner's accessibility profile has no form for were
 * left out by the server (`withheld`) and are counted with the device's own; the server's
 * `recovery` items — near-certain, not in the plan — travel with the session for the runner to
 * play before CLOSE after a wrong last answer (runner/machine.ts).
 *
 * Returns null when the plan's own node-tier is not in the packed content as the server has it
 * — the node is missing, or any of its lesson items is (a content version the device does not
 * have yet) — or when nothing of the plan can be found at all: the caller then composes the
 * device's own version of the node-tier. Reviews the device does not have are skipped.
 */
export function fromServerPlan(
  plan: SessionOut,
  units: ReadonlyMap<string, Unit>,
  opts: { profile: AccessibilityProfile },
): ComposedSession | null {
  const byId = new Map<string, Item>();
  for (const unit of units.values()) for (const node of unit.nodes) for (const items of Object.values(node.tiers)) for (const it of items ?? []) byId.set(it.id, it);

  const unitId = plan.node_id ? plan.node_id.slice(0, 6) : (plan.steps.find((s) => s.unit_id)?.unit_id ?? '');
  const unit = units.get(unitId);
  const node = plan.node_id ? unit?.nodes.find((n) => n.id === plan.node_id) : undefined;
  const tier = (plan.tier ?? 1) as Tier;
  // a node-tier that would play without its own material is no node-tier: never mark it done
  const lessonIds = plan.steps.flatMap((s) => (s.role === 'lesson' && s.item_id ? [s.item_id] : []));
  if (plan.node_id && (!node || lessonIds.some((id) => !byId.has(id)))) return null;

  const withheld: ComposedSession['withheld'] = [];
  const lessonItems: Item[] = [];
  const steps: Step[] = [];
  let found = 0;

  // the lesson items in plan order, so NEW INPUT can be built before they are placed
  for (const s of plan.steps) {
    if (s.role !== 'lesson' || !s.item_id) continue;
    const it = byId.get(s.item_id);
    if (it && !withholdReason(it, opts.profile)) lessonItems.push(it);
  }
  const cards = unit && node ? presentCards(unit, node, lessonItems, tier) : [];
  const lessonCount = lessonItems.filter((it) => !PRODUCTION_TYPES.has(it.type_id)).length;
  const guided = Math.ceil(lessonCount * 0.6);
  let lessonSeen = 0;

  for (const s of plan.steps) {
    if (s.role === 'break' || !s.item_id) continue;
    const it = byId.get(s.item_id);
    if (!it) continue;
    found += 1;
    const reason = withholdReason(it, opts.profile);
    if (reason) {
      withheld.push({ itemId: it.id, reason });
      continue;
    }
    const phase = s.phase ? SERVER_PHASE[s.phase] : undefined;
    if (s.role === 'warmup') {
      steps.push({ kind: 'item', phase: phase ?? 'warmup', item: it });
    } else if (s.role === 'lesson') {
      if (cards.length && !steps.some((x) => x.kind === 'present')) {
        for (const card of cards) steps.push({ kind: 'present', phase: 'new_input', card });
      }
      const production = PRODUCTION_TYPES.has(it.type_id);
      steps.push({ kind: 'item', phase: phase ?? (production ? 'production' : lessonSeen < guided ? 'guided' : 'integration'), item: it });
      if (!production) lessonSeen += 1;
    } else {
      // review and the close item are both scheduler-chosen reviews
      steps.push({ kind: 'item', phase: phase ?? 'review', item: it });
    }
  }
  if (found === 0) return null;
  steps.push({ kind: 'close' });

  // Left out by the server for the profile: counted once, and only what this device has.
  for (const id of plan.withheld ?? []) {
    if (byId.has(id) && !withheld.some((w) => w.itemId === id)) withheld.push({ itemId: id, reason: 'profile' });
  }
  const recovery = (plan.recovery ?? []).flatMap((s) => {
    const it = s.item_id ? byId.get(s.item_id) : undefined;
    return it && !withholdReason(it, opts.profile) ? [it] : [];
  });

  return {
    id: plan.id,
    serverId: plan.id,
    unitId,
    nodeId: plan.node_id ?? '',
    tier,
    steps,
    withheld,
    introduced: {
      lexemes: cards.flatMap((c) => (c.type === 'lexeme' ? [c.lexeme] : [])),
      grammar: cards.flatMap((c) => (c.type === 'grammar' ? [c.point.label] : [])),
    },
    recovery,
  };
}

/**
 * The units a plan's items live in (its recovery items' too), so they can be loaded before the
 * session is built — only those this app packs (`packed`): a unit from a newer content version is
 * not an error, its items are simply not on this device.
 */
export function planUnitIds(plan: SessionOut, packed?: (unitId: string) => boolean): string[] {
  const ids = new Set<string>();
  if (plan.node_id) ids.add(plan.node_id.slice(0, 6));
  for (const s of [...plan.steps, ...(plan.recovery ?? [])]) if (s.unit_id) ids.add(s.unit_id);
  return [...ids].filter((id) => !packed || packed(id));
}

/** docs/08 §4.3: tier 3 opens three days after tier 2 — the rule the server applies. */
export const TIER3_SPACING_MS = 3 * 24 * 60 * 60_000;
/** How long this device's own record of a finished tier stands in for the server's (answers
 * still in the outbox). After that the server's answer is binding: the device marks a tier done
 * at its close, the server only when it was passed. */
export const OUTBOX_GRACE_MS = 24 * 60 * 60_000;

export type DeviceGate = { kind: 'open' } | { kind: 'spaced'; availableAt: string } | { kind: 'previous_tier' };

/**
 * When the server has no record of the previous tier, may the device's own record open this one?
 * Only while that record is fresh enough to still be on its way, and never sooner than tier 3's
 * spacing allows.
 */
export function deviceGate(completedAt: Partial<Record<Tier, string>> | undefined, tier: Tier, now: number): DeviceGate {
  if (tier === 1) return { kind: 'open' };
  const previous = completedAt?.[(tier - 1) as Tier];
  const at = previous ? Date.parse(previous) : Number.NaN;
  if (!Number.isFinite(at) || now - at > OUTBOX_GRACE_MS) return { kind: 'previous_tier' };
  if (tier === 3 && now < at + TIER3_SPACING_MS) return { kind: 'spaced', availableAt: new Date(at + TIER3_SPACING_MS).toISOString() };
  return { kind: 'open' };
}
