import { describe, expect, it } from 'vitest';

import { dueFromWindow, type SavedWindow } from '@/features/garden/dueWindow';

/**
 * Watering offline plays what the server last said would be due (GET /v1/sync/bundle): only the
 * reviews whose time has come, soonest first, one exercise per memory item, never one this
 * device has already answered since the window was saved.
 */

const window: SavedWindow = {
  asOf: '2026-10-05T08:00:00Z',
  contentVersion: 'sha256:test',
  due: [
    { memoryItemId: 'lex.00002.recall', itemId: 'item.00020', dueAt: '2026-10-05T09:00:00Z' },
    { memoryItemId: 'lex.00001.recall', itemId: 'item.00010', dueAt: '2026-10-04T09:00:00Z' },
    { memoryItemId: 'lex.00001.recall', itemId: 'item.00011', dueAt: '2026-10-04T10:00:00Z' },
    { memoryItemId: 'G-107.form', itemId: 'item.00030', dueAt: '2026-10-05T11:00:00Z' },
    { memoryItemId: 'lex.00004.recall', itemId: 'item.00040', dueAt: '2026-10-09T09:00:00Z' },
    { memoryItemId: 'lex.00005.recall', itemId: 'item.00050', dueAt: 'not a date' },
  ],
};

describe('dueFromWindow', () => {
  it('plays only what has come due, soonest first, one exercise per memory item', () => {
    const { items } = dueFromWindow(window, new Date('2026-10-05T12:00:00Z'), new Set(), 15);
    expect(items).toEqual([
      { memory_item_id: 'lex.00001.recall', item_id: 'item.00010' },
      { memory_item_id: 'lex.00002.recall', item_id: 'item.00020' },
      { memory_item_id: 'G-107.form', item_id: 'item.00030' },
    ]);
  });

  it('leaves out what was answered on this device since the window was saved', () => {
    const { items } = dueFromWindow(window, new Date('2026-10-05T12:00:00Z'), new Set(['item.00020']), 15);
    expect(items.map((i) => i.item_id)).toEqual(['item.00010', 'item.00030']);
  });

  it('keeps to the limit, and nothing is due before its time', () => {
    expect(dueFromWindow(window, new Date('2026-10-05T12:00:00Z'), new Set(), 2).items).toHaveLength(2);
    expect(dueFromWindow(window, new Date('2026-10-01T00:00:00Z'), new Set(), 15).items).toEqual([]);
  });
});
