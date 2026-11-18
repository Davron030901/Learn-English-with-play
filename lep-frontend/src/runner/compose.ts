import { excludedByProfile, type AccessibilityProfile } from '@/a11y/profile';
import { stressSyllablesSpellWord } from '@/content/adapter';
import type { Lexeme, Tier, Unit, UnitNode } from '@/content/model';
import { notationKind } from '@/content/notation';
import type { Item, TypeId } from '@/content/schemas';
import { FAMILY } from '@/grading/grade';

import type { PresentCard, Step } from './phases';

/**
 * Local session composition from one node-tier — the fallback when the server cannot compose
 * (offline, an error, an older server; the server's plan is runner/serverSession.ts). Keeps the
 * build's item order inside each phase — the client does not re-sort (brief §5.6) — and:
 *   * NEW INPUT presents before anything is tested (never an exercise, brief §6.1);
 *   * WARM-UP opens with easy recognition items the learner has already met on this device;
 *   * PRODUCTION (speaking, free writing) comes last;
 *   * items the device cannot present honestly are withheld and counted, never faked.
 */

export const PRODUCTION_TYPES: ReadonlySet<TypeId> = new Set([
  'repeat_after',
  'speak_prompt',
  'read_aloud',
  'speak_roleplay',
  'speak_retell',
  'write_sentence',
]);

const WARMUP_TYPES: ReadonlySet<TypeId> = new Set(['mcq_word_from_definition', 'odd_one_out', 'tap_pairs']);
const MAX_NEW_LEXEMES = 8;
const WARMUP_ITEMS = 2;

export type WithheldReason = 'notation_audio' | 'bad_syllables' | 'profile';

export interface ComposedSession {
  id: string;
  /** Set when the server composed it (POST /v1/sessions): answers carry it as `session_id`. */
  serverId?: string;
  unitId: string;
  nodeId: string;
  tier: Tier;
  steps: Step[];
  withheld: { itemId: string; reason: WithheldReason }[];
  /** What the close screen lists under "what you learned". */
  introduced: { lexemes: Lexeme[]; grammar: string[] };
  /**
   * Near-certain items the server chose to keep the session from ending on a failure (POST
   * /v1/sessions `recovery`), in its order. Absent on a device-composed session: the runner then
   * re-presents one the learner got right.
   */
  recovery?: Item[];
}

export interface ComposeOptions {
  profile: AccessibilityProfile;
  /** Node ids (with tier) this learner finished on this device — the warm-up source. */
  completed: ReadonlyMap<string, readonly Tier[]>;
  seed: number;
}

/** A small deterministic PRNG so a session is reproducible in tests (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function withholdReason(item: Item, profile: AccessibilityProfile): WithheldReason | null {
  if (item.type_id === 'minimal_pair_discrimination' && item.say && notationKind(item.say)) return 'notation_audio';
  if (!stressSyllablesSpellWord(item)) return 'bad_syllables';
  if (excludedByProfile(item.type_id, profile)) return 'profile';
  return null;
}

export function presentCards(unit: Unit, node: UnitNode, items: readonly Item[], tier: Tier): PresentCard[] {
  if (node.kind === 'story') return [{ type: 'story', story: unit.story }];
  if (tier !== 1) return [];
  const cards: PresentCard[] = [];
  const lexIds: string[] = [];
  const grammarIds: string[] = [];
  const functionIds: string[] = [];
  for (const it of items) {
    for (const id of it.targets.lexis ?? []) if (!lexIds.includes(id)) lexIds.push(id);
    for (const id of it.targets.grammar ?? []) if (!grammarIds.includes(id)) grammarIds.push(id);
    for (const id of it.targets.functions ?? []) if (!functionIds.includes(id)) functionIds.push(id);
  }
  for (const id of grammarIds) {
    const g = unit.grammar.find((p) => p.id === id);
    if (g) cards.push({ type: 'grammar', point: g });
  }
  if (node.kind === 'speak') {
    for (const id of functionIds) {
      const f = unit.functions.find((p) => p.id === id);
      if (f) cards.push({ type: 'function', fn: f });
    }
  }
  const lexemes = lexIds
    .map((id) => unit.lexemes.find((l) => l.id === id))
    .filter((l): l is Lexeme => !!l)
    .slice(0, MAX_NEW_LEXEMES);
  for (const l of lexemes) cards.push({ type: 'lexeme', lexeme: l });
  return cards;
}

function warmupItems(unit: Unit, node: UnitNode, opts: ComposeOptions, rand: () => number): Item[] {
  const pool: Item[] = [];
  for (const n of unit.nodes) {
    if (n.position >= node.position) break;
    const done = opts.completed.get(n.id) ?? [];
    for (const t of done) {
      for (const it of n.tiers[t] ?? []) {
        if (WARMUP_TYPES.has(it.type_id) && !withholdReason(it, opts.profile)) pool.push(it);
      }
    }
  }
  const picked: Item[] = [];
  while (pool.length > 0 && picked.length < WARMUP_ITEMS) {
    const i = Math.floor(rand() * pool.length);
    const [it] = pool.splice(i, 1);
    if (it) picked.push(it);
  }
  return picked;
}

export function sessionIdFor(nodeId: string, tier: Tier): string {
  return `${nodeId}.t${tier}`;
}

export function parseSessionId(id: string): { nodeId: string; tier: Tier } | null {
  const m = id.match(/^(S\d{2}U\d{2}N\d)\.t([123])$/);
  if (!m) return null;
  return { nodeId: m[1] as string, tier: Number(m[2]) as Tier };
}

export function composeNodeSession(unit: Unit, nodeId: string, tier: Tier, opts: ComposeOptions): ComposedSession {
  const node = unit.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`no node ${nodeId} in ${unit.id}`);
  const all = node.tiers[tier] ?? [];
  const rand = seeded(opts.seed);
  const withheld: ComposedSession['withheld'] = [];
  const usable: Item[] = [];
  for (const it of all) {
    const reason = withholdReason(it, opts.profile);
    if (reason) withheld.push({ itemId: it.id, reason });
    else usable.push(it);
  }

  const steps: Step[] = [];
  for (const it of warmupItems(unit, node, opts, rand)) steps.push({ kind: 'item', phase: 'warmup', item: it });

  const cards = presentCards(unit, node, usable, tier);
  for (const card of cards) steps.push({ kind: 'present', phase: 'new_input', card });

  const practice = usable.filter((it) => !PRODUCTION_TYPES.has(it.type_id));
  const production = usable.filter((it) => PRODUCTION_TYPES.has(it.type_id));
  const guidedCount = Math.ceil(practice.length * 0.6);
  practice.forEach((it, i) => steps.push({ kind: 'item', phase: i < guidedCount ? 'guided' : 'integration', item: it }));
  for (const it of production) steps.push({ kind: 'item', phase: 'production', item: it });
  steps.push({ kind: 'close' });

  return {
    id: sessionIdFor(nodeId, tier),
    unitId: unit.id,
    nodeId,
    tier,
    steps,
    withheld,
    introduced: {
      lexemes: cards.flatMap((c) => (c.type === 'lexeme' ? [c.lexeme] : [])),
      grammar: cards.flatMap((c) => (c.type === 'grammar' ? [c.point.label] : [])),
    },
  };
}

/** Recognition items: the easy end a review session warms up with (never production). */
function isRecognition(it: Item): boolean {
  return WARMUP_TYPES.has(it.type_id) || FAMILY[it.type_id] === 'choice' || FAMILY[it.type_id] === 'pairs';
}

/**
 * A review session from the server scheduler's own item choice (GET /v1/reviews/due, docs/08 §5):
 * the client never picks *what* is reviewed, only how the chosen items are ordered on screen.
 *
 *   * the server's order (most forgotten first) is kept for the REVIEW phase;
 *   * a WARM-UP of up to two recognition items opens the session — taken from the easy end of
 *     the queue (the server sorts the least-forgotten last), so nobody starts on the hardest word;
 *   * PRODUCTION (speaking, free writing) comes last, as in every session (docs/07 §3.2);
 *   * there are no NEW INPUT cards: nothing here is new;
 *   * an item id no loaded unit has is skipped (the caller reports it), a duplicate is used once,
 *     and an item this device cannot present honestly is withheld and counted, never faked.
 *
 * Returns null when none of the ids could be found at all.
 */
export function composeFromItems(
  units: ReadonlyMap<string, Unit> | readonly Unit[],
  itemIds: readonly string[],
  opts: { profile: AccessibilityProfile; seed: number; id?: string },
): ComposedSession | null {
  const byId = new Map<string, Item>();
  const list: readonly Unit[] = Array.isArray(units) ? units : [...(units as ReadonlyMap<string, Unit>).values()];
  for (const unit of list) for (const node of unit.nodes) for (const items of Object.values(node.tiers)) for (const it of items ?? []) byId.set(it.id, it);

  const seen = new Set<string>();
  const withheld: ComposedSession['withheld'] = [];
  const usable: Item[] = [];
  let found = 0;
  for (const id of itemIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const it = byId.get(id);
    if (!it) continue;
    found += 1;
    const reason = withholdReason(it, opts.profile);
    if (reason) withheld.push({ itemId: it.id, reason });
    else usable.push(it);
  }
  if (found === 0) return null;

  const production = usable.filter((it) => PRODUCTION_TYPES.has(it.type_id));
  const rest = usable.filter((it) => !PRODUCTION_TYPES.has(it.type_id));
  // The easy end of the queue: walk it from the back, recognition first; with no recognition
  // item at all, the single easiest item warms up (only when something else follows it).
  const warm = new Set<Item>();
  for (let i = rest.length - 1; i >= 0 && warm.size < WARMUP_ITEMS; i -= 1) {
    const it = rest[i] as Item;
    if (isRecognition(it)) warm.add(it);
  }
  if (warm.size === 0 && rest.length > 1) warm.add(rest[rest.length - 1] as Item);
  const warmup = rest.filter((it) => warm.has(it));
  const review = rest.filter((it) => !warm.has(it));

  const steps: Step[] = [
    ...warmup.map((item): Step => ({ kind: 'item', phase: 'warmup', item })),
    ...review.map((item): Step => ({ kind: 'item', phase: 'review', item })),
    ...production.map((item): Step => ({ kind: 'item', phase: 'production', item })),
    { kind: 'close' },
  ];
  const first = usable[0] ?? byId.get(withheld[0]?.itemId ?? '');
  return {
    id: opts.id ?? `review.${opts.seed}`,
    unitId: first?.unit ?? '',
    // Not a node-tier: finishing a review completes nothing on the path.
    nodeId: '',
    tier: 1,
    steps,
    withheld,
    introduced: { lexemes: [], grammar: [] },
  };
}

/**
 * Practice outside the path: an interleaved mix of items from node-tiers the learner finished
 * on this device. Not the SRS review (the scheduler is the server's); labelled as such.
 */
export function composePracticeSession(
  units: readonly Unit[],
  completed: ReadonlyMap<string, readonly Tier[]>,
  opts: { profile: AccessibilityProfile; seed: number; size: number },
): ComposedSession | null {
  const rand = seeded(opts.seed);
  const pool: Item[] = [];
  for (const unit of units) {
    for (const node of unit.nodes) {
      for (const t of completed.get(node.id) ?? []) {
        for (const it of node.tiers[t] ?? []) {
          if (FAMILY[it.type_id] === 'speak' || it.type_id === 'write_sentence') continue;
          if (!withholdReason(it, opts.profile)) pool.push(it);
        }
      }
    }
  }
  if (pool.length === 0) return null;
  const chosen: Item[] = [];
  while (pool.length > 0 && chosen.length < opts.size) {
    const [it] = pool.splice(Math.floor(rand() * pool.length), 1);
    if (it) chosen.push(it);
  }
  // Easiest first: recognition, then recall (never open with the hardest content).
  const rank = (it: Item) => (FAMILY[it.type_id] === 'choice' || FAMILY[it.type_id] === 'pairs' ? 0 : 1);
  chosen.sort((a, b) => rank(a) - rank(b));
  const first = units[0];
  return {
    id: `practice.${opts.seed}`,
    unitId: first?.id ?? '',
    nodeId: '',
    tier: 1,
    steps: [
      ...chosen.map((item, i): Step => ({ kind: 'item', phase: i < 2 ? 'warmup' : 'integration', item })),
      { kind: 'close' },
    ],
    withheld: [],
    introduced: { lexemes: [], grammar: [] },
  };
}
