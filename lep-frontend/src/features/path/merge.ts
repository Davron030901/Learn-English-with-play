import type { ProgressOut } from '@/api/types';
import type { Course, Tier, UnitOutline } from '@/content/model';

import { unitIdOfNode } from './position';

/**
 * The path's ticks from two honest sources (docs/16 E08, DECISIONS F22): the server's progress
 * (GET /v1/progress — per node the highest tier the account has completed, and which units are
 * complete) and the tiers this device finished that may still be waiting to sync. Nothing is
 * inferred beyond that: a tier counts when one of the two says so.
 */
export interface ServerPath {
  /** node id → the highest tier the server has recorded. */
  tiers: ReadonlyMap<string, number>;
  doneUnits: ReadonlySet<string>;
  currentUnit: string | null;
}

export function serverPathOf(progress: ProgressOut | null | undefined): ServerPath | null {
  if (!progress) return null;
  const tiers = new Map<string, number>();
  const doneUnits = new Set<string>();
  for (const u of progress.units) {
    if (u.completed) doneUnits.add(u.unit_id);
    for (const [node, tier] of Object.entries(u.tiers)) if (tier > 0) tiers.set(node, Math.max(tier, tiers.get(node) ?? 0));
  }
  return { tiers, doneUnits, currentUnit: progress.current_unit || null };
}

/** The device's finished tiers with the server's added: a node's tiers up to its recorded highest. */
export function mergeTiers(course: Course, device: ReadonlyMap<string, readonly Tier[]>, server: ServerPath | null): Map<string, Tier[]> {
  const out = new Map<string, Tier[]>();
  for (const [node, tiers] of device) out.set(node, [...tiers]);
  if (!server) return out;
  for (const [nodeId, highest] of server.tiers) {
    const node = course.unitsById.get(unitIdOfNode(nodeId))?.nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    const have = out.get(nodeId) ?? [];
    const add = node.populatedTiers.filter((t) => t <= highest && !have.includes(t));
    if (add.length) out.set(nodeId, [...have, ...add].sort((a, b) => a - b));
  }
  return out;
}

/** Every populated tier of every node in the unit is done (by either source). */
export function unitAllDone(unit: UnitOutline, done: ReadonlyMap<string, readonly Tier[]>): boolean {
  const nodes = unit.nodes.filter((n) => n.populatedTiers.length > 0);
  return nodes.length > 0 && nodes.every((n) => n.populatedTiers.every((t) => (done.get(n.id) ?? []).includes(t)));
}
