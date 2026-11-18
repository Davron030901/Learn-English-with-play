import { beforeAll, describe, expect, it } from 'vitest';

import type { Course, Tier } from '@/content/model';
import { ContentRepository } from '@/content/repository';
import { gradeContextFor, hintMessage, nextAfter, toSubmissionRecord, withCompleted } from '@/features/lesson/record';
import { OUTBOX_CAPACITY, Outbox, memoryStore, type NewRecord, type ReviewPayload } from '@/outbox/outbox';
import { serverSupportsSync, syncOutbox } from '@/outbox/sync';
import {
  HARD_CAP_PER_DAY,
  applyReminders,
  clampToAllowed,
  insideQuietHours,
  missedSince,
  reminderTimes,
} from '@/notifications/reminders';
import type { ReminderPrefs } from '@/state/prefs';

import { fsContentSource } from '../support/fsSource';
import { makeItem } from '../support/items';

const REMINDERS: ReminderPrefs = {
  enabled: true,
  hour: 19,
  minute: 0,
  cue: 'dinner',
  perDay: 1,
  ignoredInARow: 0,
  weekly: false,
  paused: false,
  lastScheduledAt: null,
  lastOpenedAt: null,
};

const payload = (over: Partial<ReviewPayload> = {}): ReviewPayload => ({
  item_id: 'item.0000001',
  session_id: 'run-1',
  submission: { kind: 'choice', index: 1 },
  rt_ms: 1200,
  hints_used: 0,
  plays_used: 1,
  started_at: '2026-10-01T08:00:00.000Z',
  content_version: 'sha256:test',
  local_verdict: 'correct',
  local_typo: false,
  ...over,
});
const review = (id: string, over: Partial<ReviewPayload> = {}): NewRecord => ({ kind: 'review', client_uuid: id, created_at: '2026-10-01T08:00:01.000Z', monotonic_ms: 1000, payload: payload(over) });

describe('the durable outbox (brief §11)', () => {
  it('stores rows durably, in order, and survives a restart', async () => {
    const store = memoryStore();
    const box = new Outbox(store, 'learner-1');
    expect(await box.enqueue(review('a'))).toBe(true);
    expect(await box.enqueue(review('b'))).toBe(true);
    const again = new Outbox(store, 'learner-1');
    expect((await again.list()).map((r) => r.client_uuid)).toEqual(['a', 'b']);
    expect((await again.list())[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('client_uuid is the idempotency key: enqueueing twice stores once', async () => {
    const box = new Outbox(memoryStore(), 'l');
    await box.enqueue(review('a'));
    await box.enqueue(review('a', { local_verdict: 'incorrect' }));
    const rows = await box.list();
    expect(rows).toHaveLength(1);
    // A queued answer is never edited.
    expect(rows[0]?.kind === 'review' && rows[0].payload.local_verdict).toBe('correct');
  });

  it('removes only acknowledged rows; rejected rows stay, visible', async () => {
    const box = new Outbox(memoryStore(), 'l');
    for (const id of ['a', 'b', 'c']) await box.enqueue(review(id));
    await box.acknowledge(['b']);
    await box.markRejected([{ client_uuid: 'c', type: 'validation_error', request_id: 'req-1' }]);
    const rows = await box.list();
    expect(rows.map((r) => [r.client_uuid, r.status])).toEqual([
      ['a', 'pending'],
      ['c', 'rejected'],
    ]);
    expect(rows[1]?.last_error).toMatchObject({ type: 'validation_error', request_id: 'req-1' });
  });

  it('serialises concurrent writes (no lost index updates)', async () => {
    const box = new Outbox(memoryStore(), 'l');
    await Promise.all(Array.from({ length: 50 }, (_, i) => box.enqueue(review(`r${i}`))));
    expect(await box.size()).toBe(50);
  });

  it('keeps learners apart and refuses rows past capacity instead of dropping old ones', async () => {
    const store = memoryStore();
    await new Outbox(store, 'one').enqueue(review('a'));
    expect(await new Outbox(store, 'two').size()).toBe(0);
    const full = new Outbox(store, 'full');
    for (let i = 0; i < OUTBOX_CAPACITY; i += 1) await store.setItem(`lep:outbox:full:row:x${i}`, JSON.stringify({ client_uuid: `x${i}` }));
    expect(await full.enqueue(review('late'))).toBe(false);
    expect(await full.size()).toBe(OUTBOX_CAPACITY);
  });

  it("two tabs writing to one store never orphan each other's answers (audit 2026-10-03)", async () => {
    const store = memoryStore();
    const tabA = new Outbox(store, 'l');
    const tabB = new Outbox(store, 'l');
    await tabA.list(); // both tabs have looked before either writes
    await tabB.list();
    await tabA.enqueue(review('from-a'));
    await tabB.enqueue(review('from-b'));
    await tabA.enqueue(review('from-a-2'));
    expect((await new Outbox(store, 'l').list()).map((r) => r.client_uuid).sort()).toEqual(['from-a', 'from-a-2', 'from-b']);
  });

  it('one answer is one write: no index row to fall out of step with', async () => {
    const store = memoryStore();
    await new Outbox(store, 'l').enqueue(review('a'));
    expect(Object.keys(store.dump())).toEqual(['lep:outbox:l:row:a']);
  });

  it('clear() empties it (only "delete everything on this device" calls it)', async () => {
    const box = new Outbox(memoryStore(), 'l');
    await box.enqueue(review('a'));
    await box.clear();
    expect(await box.list()).toEqual([]);
  });

  it('replays in time order and keeps what the server refused', async () => {
    const box = new Outbox(memoryStore(), 'l');
    await box.enqueue({ ...review('late'), created_at: '2026-10-01T09:00:00.000Z' });
    await box.enqueue({ ...review('early'), created_at: '2026-10-01T08:00:00.000Z' });
    const sent: string[] = [];
    const outcome = await syncOutbox(box, {
      send: (batch) => {
        sent.push(...batch.map((r) => r.client_uuid));
        return Promise.resolve({ accepted: ['early'], rejected: [{ client_uuid: 'late', type: 'validation_error', request_id: null }] });
      },
    });
    expect(sent).toEqual(['early', 'late']);
    expect(outcome).toEqual({ state: 'sent', accepted: 1, rejected: 1 });
    expect((await box.list()).map((r) => [r.client_uuid, r.status])).toEqual([['late', 'rejected']]);
  });

  it('waits, without sending anything, while the server has no sync endpoint', async () => {
    expect(serverSupportsSync(['GET /v1/me'])).toBe(false);
    expect(serverSupportsSync()).toBe(true);
    const box = new Outbox(memoryStore(), 'l');
    await box.enqueue(review('a'));
    expect(await syncOutbox(box, null)).toEqual({ state: 'waiting_for_server', pending: 1 });
    expect(await box.size()).toBe(1);
  });
});

describe('lesson records', () => {
  const repo = new ContentRepository(fsContentSource);
  let course: Course;
  beforeAll(async () => {
    course = await repo.loadCourse();
  });

  it('stores bank answers with the text the learner built, and never a recording', () => {
    const bank = makeItem('sentence_reorder', { bank: ['I', 'am', 'Aziz', '.'] }, { key: ['I am Aziz.'] });
    expect(toSubmissionRecord(bank, { kind: 'tiles', indices: [0, 1, 2, 3] })).toEqual({ kind: 'tiles', indices: [0, 1, 2, 3], text: 'I am Aziz.' });
    const sp = makeItem('read_aloud', { text: 'Hi' }, { key: ['Hi'] });
    expect(toSubmissionRecord(sp, { kind: 'speech', modality: 'voice', text: 'leaked' })).toEqual({ kind: 'speech', modality: 'voice' });
    expect(toSubmissionRecord(sp, { kind: 'speech', modality: 'typed', text: 'Hi' })).toEqual({ kind: 'speech', modality: 'typed', text: 'Hi' });
  });

  it('copies, never aliases, the renderer’s objects', () => {
    const indices = [1, 0];
    const it = makeItem('listen_order_events', { audio: 'a', options: ['x', 'y'] }, { key: ['y', 'x'] });
    const rec = toSubmissionRecord(it, { kind: 'order', indices });
    indices.push(9);
    expect(rec).toEqual({ kind: 'order', indices: [1, 0] });
  });

  it('next lesson: the next tier of this node first, then the next node with items', () => {
    const none = new Map<string, Tier[]>();
    expect(nextAfter(course, 'S01U01N1', 1, withCompleted(none, 'S01U01N1', 1))).toMatchObject({ nodeId: 'S01U01N1', tier: 2 });
    const all3 = withCompleted(withCompleted(withCompleted(none, 'S01U01N1', 1), 'S01U01N1', 2), 'S01U01N1', 3);
    expect(nextAfter(course, 'S01U01N1', 3, all3)).toMatchObject({ nodeId: 'S01U01N2', tier: 1 });
    // tier 3 opens three days after tier 2: right after tier 2, "next" is the next node
    const two = withCompleted(withCompleted(none, 'S01U01N1', 1), 'S01U01N1', 2);
    expect(nextAfter(course, 'S01U01N1', 2, two)).toMatchObject({ nodeId: 'S01U01N2', tier: 1 });
    // Immersion (N7) and review (N8) carry no items: S01U01N6 leads to S01U02N1.
    const n6 = withCompleted(withCompleted(withCompleted(none, 'S01U01N6', 1), 'S01U01N6', 2), 'S01U01N6', 3);
    expect(nextAfter(course, 'S01U01N6', 3, n6)).toMatchObject({ nodeId: 'S01U02N1', tier: 1 });
    expect(nextAfter(course, 'S10U24N6', 3, withCompleted(withCompleted(withCompleted(none, 'S10U24N6', 1), 'S10U24N6', 2), 'S10U24N6', 3))).toBeNull();
  });

  it('grade context carries the item’s target lemmas and function exponents', async () => {
    const unit = await repo.loadUnit('S01U01');
    const item = unit.nodes.flatMap((n) => Object.values(n.tiers).flat()).find((i) => i && (i.targets.lexis?.length ?? 0) > 0);
    expect(item).toBeDefined();
    if (!item) return;
    const ctx = gradeContextFor(item, unit, new Set());
    expect(ctx.targetLemmas?.length).toBeGreaterThan(0);
    expect(gradeContextFor(item, undefined, new Set())).toEqual({ words: new Set() });
  });

  it('hint copy keys', () => {
    expect(hintMessage({ kind: 'first_letter', letter: 'h' })).toEqual({ key: 'lesson.hintFirstLetter', values: { letter: 'h' } });
    expect(hintMessage({ kind: 'look_at', span: 'go' }).key).toBe('lesson.hintLookAt');
  });
});

describe('reminders (docs/10 §7)', () => {
  it('never inside quiet hours 21:00–08:00', () => {
    expect(insideQuietHours(21)).toBe(true);
    expect(insideQuietHours(7)).toBe(true);
    expect(insideQuietHours(8)).toBe(false);
    expect(clampToAllowed(6, 30)).toEqual({ hour: 8, minute: 0 });
    expect(clampToAllowed(22, 0)).toEqual({ hour: 20, minute: 45 });
  });

  it('one a day by default; two only if asked; a possible minor gets one', () => {
    expect(reminderTimes({ hour: 9, minute: 0, perDay: 1 }, false)).toEqual([{ hour: 9, minute: 0 }]);
    expect(reminderTimes({ hour: 9, minute: 0, perDay: 2 }, false)).toEqual([
      { hour: 9, minute: 0 },
      { hour: 13, minute: 0 },
    ]);
    expect(reminderTimes({ hour: 9, minute: 0, perDay: 2 }, true)).toHaveLength(1);
    // The second would land in quiet hours: dropped, never moved.
    expect(reminderTimes({ hour: 19, minute: 0, perDay: 2 }, false)).toEqual([{ hour: 19, minute: 0 }]);
    expect(HARD_CAP_PER_DAY).toBe(3);
  });

  it('counts reminders that fired while the app stayed closed', () => {
    const times = [{ hour: 19, minute: 0 }];
    const last = new Date(2026, 9, 1, 20, 0);
    expect(missedSince(last, new Date(2026, 9, 2, 18, 0), times)).toBe(0);
    expect(missedSince(last, new Date(2026, 9, 6, 20, 0), times)).toBe(5);
  });

  it('the web build schedules nothing', async () => {
    expect(await applyReminders(REMINDERS, 'text', false)).toBe('unsupported');
  });
});
