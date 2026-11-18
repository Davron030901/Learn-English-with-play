import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { Unit } from '@/content/model';
import type { Item } from '@/content/schemas';
import { content } from '@/content/queries';
import { locateItems } from '@/features/garden/reviewQueue';

/** Every item of a unit by id (items live in the unit's node tiers). */
export function itemsById(unit: Unit): Map<string, Item> {
  const out = new Map<string, Item>();
  for (const node of unit.nodes)
    for (const list of Object.values(node.tiers)) for (const it of list ?? []) out.set(it.id, it);
  return out;
}

// Module-level so TanStack Query keeps the combined result stable between renders.
function combineUnits(results: UseQueryResult<Unit>[]) {
  return {
    list: results.flatMap((r) => (r.data ? [r.data] : [])),
    pending: results.some((r) => r.isPending),
    error: results.find((r) => r.error)?.error ?? null,
  };
}

/**
 * The items an assessment asks, in the server's order, from the packed units that hold them.
 * `missing` lists ids this device's content does not have (an older app against a newer
 * server): the caller leaves them unanswered and the server grades what it got.
 */
export function useAssessmentItems(itemIds: readonly string[], unitIds: readonly string[]) {
  const units = useQueries({
    queries: unitIds.map((id) => ({
      queryKey: ['content', 'unit', id],
      queryFn: () => content.loadUnit(id),
      staleTime: Infinity,
      gcTime: 30 * 60_000,
    })),
    combine: combineUnits,
  });
  return useMemo(() => {
    const map = new Map<string, Unit>(units.list.map((u) => [u.id, u]));
    const byId = new Map<string, Item>();
    for (const u of units.list) for (const [id, it] of itemsById(u)) byId.set(id, it);
    const items = itemIds.flatMap((id) => {
      const it = byId.get(id);
      return it ? [it] : [];
    });
    const missing = units.pending ? [] : itemIds.filter((id) => !byId.has(id));
    return { items, units: map, missing, pending: units.pending, error: units.error };
  }, [units, itemIds]);
}

/**
 * The items of an assessment that spans a whole level (the level exam): the server names them by
 * id only, across many units, so they are found in the packed course by the same search the
 * garden uses (features/garden/reviewQueue.ts). Ids the device does not have are `missing`: they
 * stay unanswered and the server counts them as wrong, and the screen says so beforehand.
 */
export function useLocatedItems(itemIds: readonly string[], unitOrder: readonly string[]) {
  const key = itemIds.join(',');
  const located = useQuery({
    queryKey: ['content', 'located', key],
    queryFn: () =>
      locateItems(itemIds, { unitOrder, loadUnit: (id) => content.loadUnit(id), maxLoads: 168 }),
    enabled: itemIds.length > 0 && unitOrder.length > 0,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });
  return useMemo(() => {
    const units = located.data?.units ?? new Map<string, Unit>();
    const byId = new Map<string, Item>();
    for (const u of units.values()) for (const [id, it] of itemsById(u)) byId.set(id, it);
    const items = itemIds.flatMap((id) => {
      const it = byId.get(id);
      return it ? [it] : [];
    });
    return {
      items,
      units,
      missing: located.data?.missing ?? [],
      pending: located.isPending,
      error: located.error,
    };
  }, [located.data, located.isPending, located.error, itemIds]);
}
