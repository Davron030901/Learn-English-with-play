import type { AccessibilityProfile } from '@/a11y/profile';
import type { DueQueue, ProgressOut } from '@/api/types';
import type { Unit } from '@/content/model';
import { composeFromItems, type ComposedSession } from '@/runner/compose';

/**
 * Turning the scheduler's due queue (GET /v1/reviews/due) into a session the lesson runner can
 * play. The server names items by id only, so the device finds them in its packed units:
 *
 *   1. the learner's own units first (where nearly every review item lives);
 *   2. then a binary search over the course: item ids rise with the course order, so a unit's
 *      lowest and highest id say on which side of it an item lies — a handful of unit reads
 *      instead of 168.
 *
 * An id that no unit holds is reported as missing and left for the next watering; nothing is
 * substituted for it (the scheduler, not the device, decides what is reviewed).
 */

export interface LocateDeps {
  /** Every unit id, in course order. */
  unitOrder: readonly string[];
  loadUnit: (unitId: string) => Promise<Unit>;
  /** Units to look in first, most likely first. */
  hints?: readonly string[];
  /** At most this many units are read (each is a packed file to parse). */
  maxLoads?: number;
}

export interface Located {
  /** The units holding the items that were found. */
  units: Map<string, Unit>;
  missing: string[];
  /** How many units were read to find them. */
  loads: number;
}

export function itemNumber(id: string): number {
  const m = /^item\.(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.NaN;
}

export async function locateItems(itemIds: readonly string[], deps: LocateDeps): Promise<Located> {
  const wanted = [...new Set(itemIds)];
  const want = new Set(wanted);
  const max = deps.maxLoads ?? 40;
  const loaded = new Map<string, Unit | null>();
  const ranges = new Map<string, readonly [number, number]>();
  const where = new Map<string, string>();
  let loads = 0;

  const load = async (unitId: string): Promise<boolean> => {
    if (loaded.has(unitId)) return true;
    if (loads >= max) return false;
    loads += 1;
    let unit: Unit | null = null;
    try {
      unit = await deps.loadUnit(unitId);
    } catch {
      unit = null;
    }
    loaded.set(unitId, unit);
    if (!unit) return true;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const node of unit.nodes) {
      for (const items of Object.values(node.tiers)) {
        for (const it of items ?? []) {
          const n = itemNumber(it.id);
          if (n < lo) lo = n;
          if (n > hi) hi = n;
          if (want.has(it.id)) where.set(it.id, unitId);
        }
      }
    }
    if (lo <= hi) ranges.set(unitId, [lo, hi]);
    return true;
  };

  const done = () => wanted.every((id) => where.has(id));

  for (const unitId of deps.hints ?? []) {
    if (done()) break;
    await load(unitId);
  }

  // Units that turned out empty or unreadable are dropped from the search as they are found.
  const candidates = [...deps.unitOrder];
  for (const id of wanted) {
    if (where.has(id)) continue;
    const n = itemNumber(id);
    if (!Number.isFinite(n)) continue;
    // Already inside a unit we read? Then that unit does not hold it: the id is gone.
    if ([...ranges.values()].some(([a, b]) => a <= n && n <= b)) continue;
    let lo = 0;
    let hi = candidates.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const unitId = candidates[mid] as string;
      if (!(await load(unitId))) break;
      const range = ranges.get(unitId);
      if (!range) {
        candidates.splice(mid, 1);
        hi -= 1;
        continue;
      }
      if (n < range[0]) hi = mid - 1;
      else if (n > range[1]) lo = mid + 1;
      else break;
    }
  }

  const units = new Map<string, Unit>();
  for (const id of wanted) {
    const unitId = where.get(id);
    const unit = unitId ? loaded.get(unitId) : null;
    if (unitId && unit) units.set(unitId, unit);
  }
  return { units, missing: wanted.filter((id) => !where.has(id)), loads };
}

/**
 * Where to look first: the units this device finished lessons in (most recent first), then the
 * units the server says the learner has worked in. At most 16, so a hint never costs much.
 */
export function reviewHints(
  completed: Readonly<Record<string, Readonly<Partial<Record<number, string>>>>>,
  progress?: Pick<ProgressOut, 'current_unit' | 'units'> | null,
): string[] {
  const out: string[] = [];
  const push = (unitId: string) => {
    if (/^S\d{2}U\d{2}$/.test(unitId) && !out.includes(unitId)) out.push(unitId);
  };
  const rows: { unitId: string; at: string }[] = [];
  for (const [nodeId, tiers] of Object.entries(completed)) {
    for (const at of Object.values(tiers)) if (at) rows.push({ unitId: nodeId.slice(0, 6), at });
  }
  rows.sort((a, b) => b.at.localeCompare(a.at)).forEach((r) => push(r.unitId));
  if (progress) {
    push(progress.current_unit);
    for (const u of [...progress.units].reverse()) push(u.unit_id);
  }
  return out.slice(0, 16);
}

/** 'lex.00012.recall' → 'lex.00012'; other memory items (grammar, sounds) have no plant. */
export function lexemeOfMemoryItem(memoryItemId: string): string | null {
  if (!memoryItemId.startsWith('lex.')) return null;
  const cut = memoryItemId.lastIndexOf('.');
  return cut > 4 ? memoryItemId.slice(0, cut) : memoryItemId;
}

export interface ReviewPlan {
  session: ComposedSession | null;
  units: Map<string, Unit>;
  missing: string[];
  /** item id → the lexemes (plants) answering it waters. */
  plantsByItem: Map<string, string[]>;
}

/** What a review needs from a queue: the server's queue, or the offline window's due items. */
export type ReviewQueue = { items: readonly Pick<DueQueue['items'][number], 'memory_item_id' | 'item_id'>[] };

export async function planReview(
  due: ReviewQueue,
  deps: LocateDeps & { profile: AccessibilityProfile; seed: number },
): Promise<ReviewPlan> {
  const itemIds = due.items.map((d) => d.item_id);
  const plantsByItem = new Map<string, string[]>();
  for (const d of due.items) {
    const lexeme = lexemeOfMemoryItem(d.memory_item_id);
    if (!lexeme) continue;
    const list = plantsByItem.get(d.item_id) ?? [];
    if (!list.includes(lexeme)) list.push(lexeme);
    plantsByItem.set(d.item_id, list);
  }
  const located = await locateItems(itemIds, deps);
  const session = composeFromItems(located.units, itemIds, { profile: deps.profile, seed: deps.seed });
  return { session, units: located.units, missing: located.missing, plantsByItem };
}
