import type { Course, Tier, UnitOutline } from '@/content/model';

/**
 * The learner's place on the path, from what they finished on this device: the first
 * item-bearing node-tier not yet finished, from the section they chose to start at. A position,
 * not a statistic — nothing here is shown as a number (brief §8.4 guardrail 9).
 */
export interface PathPosition {
  unit: UnitOutline;
  nodeId: string;
  tier: Tier;
  started: boolean;
}

export function currentPosition(
  course: Course,
  completed: ReadonlyMap<string, readonly Tier[]>,
  startSection: number,
  /** From the server's progress (docs/16 E08): where to start looking, and units already done. */
  server?: { fromUnit?: string | null; doneUnits?: ReadonlySet<string> },
): PathPosition | null {
  const sections = course.sections.slice(Math.max(0, startSection - 1));
  const from = server?.fromUnit && course.unitsById.has(server.fromUnit) ? server.fromUnit : null;
  let started = false;
  for (const s of course.sections) for (const u of s.units) for (const n of u.nodes) if ((completed.get(n.id) ?? []).length) started = true;
  // The server's current unit wins over the chosen start section (placement and test-outs move it).
  let looking = from === null;
  for (const s of from ? course.sections : sections) {
    for (const u of s.units) {
      if (u.id === from) looking = true;
      if (!looking || server?.doneUnits?.has(u.id)) continue;
      for (const n of u.nodes) {
        if (n.kind === 'immersion' || n.kind === 'review') continue;
        const done = completed.get(n.id) ?? [];
        const next = n.populatedTiers.find((t) => !done.includes(t));
        if (next) return { unit: u, nodeId: n.id, tier: next, started };
      }
    }
  }
  return null;
}

export function nextNodeAfter(course: Course, nodeId: string): { unit: UnitOutline; nodeId: string; title: string } | null {
  let found = false;
  for (const s of course.sections) {
    for (const u of s.units) {
      for (const n of u.nodes) {
        if (found && (n.kind === 'lesson' || n.kind === 'story' || n.kind === 'speak')) return { unit: u, nodeId: n.id, title: n.title };
        if (n.id === nodeId) found = true;
      }
    }
  }
  return null;
}

export function unitIdOfNode(nodeId: string): string {
  return nodeId.slice(0, 6);
}
