/**
 * The reviews due in the next seven days, as the server last said, and which of them have come
 * due — pure, so it is tested without the device (see offlineWindow.ts for where it is kept).
 */

export interface SavedDue {
  memoryItemId: string;
  itemId: string;
  dueAt: string;
}

export interface SavedWindow {
  /** When the server computed it. */
  asOf: string;
  contentVersion: string;
  /** Soonest first, as the server sent them. */
  due: SavedDue[];
}

/**
 * The saved reviews whose time has come at `now`, soonest first: one exercise per memory item,
 * none this device has answered since the window was saved, at most `limit`.
 */
export function dueFromWindow(
  window: SavedWindow,
  now: Date,
  answeredItemIds: ReadonlySet<string>,
  limit: number,
): { items: { memory_item_id: string; item_id: string }[] } {
  const at = now.getTime();
  const seen = new Set<string>();
  const items: { memory_item_id: string; item_id: string }[] = [];
  const ordered = [...window.due].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  for (const d of ordered) {
    if (items.length >= limit) break;
    const due = Date.parse(d.dueAt);
    if (!Number.isFinite(due) || due > at) continue;
    if (answeredItemIds.has(d.itemId) || seen.has(d.memoryItemId)) continue;
    seen.add(d.memoryItemId);
    items.push({ memory_item_id: d.memoryItemId, item_id: d.itemId });
  }
  return { items };
}
