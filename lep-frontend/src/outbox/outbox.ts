import { log } from '@/lib/log';

/**
 * The durable outbox (brief §11). Every answer becomes a stored row *before* anything tries to
 * send it; `client_uuid` is the idempotency key (the server keeps UNIQUE (learner_id,
 * client_uuid)), so replaying a batch is a no-op there.
 *
 * Rules kept here:
 *   * a queued answer is never edited and two answers are never merged;
 *   * rows are only removed after the server has accepted them;
 *   * a row the server rejects is kept and shown to the learner, never dropped silently;
 *   * the device clock is recorded *and* a monotonic time since the session started, so the
 *     server can anchor a device whose clock is wrong.
 */

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Every stored key that starts with `prefix`. */
  keysWithPrefix(prefix: string): Promise<string[]>;
  /** Values for several keys in one call (one read on native), in the order asked. */
  multiGet(keys: readonly string[]): Promise<(string | null)[]>;
}

export function memoryStore(): KeyValueStore & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => Promise.resolve(m.get(k) ?? null),
    setItem: (k, v) => {
      m.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k) => {
      m.delete(k);
      return Promise.resolve();
    },
    keysWithPrefix: (prefix) => Promise.resolve([...m.keys()].filter((k) => k.startsWith(prefix))),
    multiGet: (keys) => Promise.resolve(keys.map((k) => m.get(k) ?? null)),
    dump: () => Object.fromEntries(m),
  };
}

export type SubmissionRecord =
  | { kind: 'choice'; index: number }
  | { kind: 'text'; text: string }
  | { kind: 'tiles'; indices: number[]; text: string }
  | { kind: 'order'; indices: number[] }
  | { kind: 'pairs'; matches: [number, number][]; mistakes: number; complete: boolean; attempts?: [number, number][]; timed_out?: boolean }
  | { kind: 'bins'; assignment: Record<number, number> }
  | { kind: 'speech'; modality: 'voice' | 'typed'; text?: string; duration_ms?: number }
  | { kind: 'timeout' };

export interface ReviewPayload {
  item_id: string;
  session_id: string;
  submission: SubmissionRecord;
  /** Clamped to [250 ms, 120 s] before it is stored (brief §5.7). */
  rt_ms: number;
  hints_used: number;
  plays_used: number;
  started_at: string;
  /** The content the learner actually saw (brief §11: sent even when it has since changed). */
  content_version: string;
  /** The device's optimistic verdict, so the server can measure disagreement. */
  local_verdict: 'correct' | 'incorrect' | 'ungraded';
  local_typo: boolean;
}

export interface DisputePayload {
  /** The answer being disputed, by its own client_uuid (DECISIONS B11). */
  review_client_uuid: string;
  item_id: string;
}

export type OutboxRecord =
  | ({ kind: 'review'; payload: ReviewPayload } & RecordMeta)
  | ({ kind: 'dispute'; payload: DisputePayload } & RecordMeta);

interface RecordMeta {
  client_uuid: string;
  created_at: string;
  /** Milliseconds since the session started, from a monotonic clock. */
  monotonic_ms: number;
  attempts: number;
  status: 'pending' | 'rejected';
  last_error?: { type: string; request_id: string | null; at: string };
  /** Insertion order on this device (rows written before this field existed sort first). */
  seq?: number;
}

export type NewRecord =
  | { kind: 'review'; client_uuid: string; created_at: string; monotonic_ms: number; payload: ReviewPayload }
  | { kind: 'dispute'; client_uuid: string; created_at: string; monotonic_ms: number; payload: DisputePayload };

/** Rows kept on the device at most; past this, new answers are not stored and the learner is told. */
export const OUTBOX_CAPACITY = 5000;

/**
 * Each answer is exactly one stored row, written in one `setItem`, and rows are found by key
 * prefix — there is no separate index. An index made two writes per answer (a kill between them
 * orphaned the row) and, on the web, two open tabs each cached their own copy and overwrote the
 * other's, orphaning answers (audit, 2026-10-03).
 */
export class Outbox {
  private readonly store: KeyValueStore;
  private readonly prefix: string;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private seq = 0;

  constructor(store: KeyValueStore, learnerId: string) {
    this.store = store;
    this.prefix = `lep:outbox:${learnerId}`;
  }

  private get rowPrefix(): string {
    return `${this.prefix}:row:`;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** Serialises this instance's writes, so its own capacity checks never race each other. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private rowKeys(): Promise<string[]> {
    return this.store.keysWithPrefix(this.rowPrefix);
  }

  /** Grows across restarts too: wall-clock microseconds, then a counter within one millisecond. */
  private nextSeq(): number {
    this.seq = Math.max(this.seq + 1, Date.now() * 1000);
    return this.seq;
  }

  /** Stores a new row durably. Returns false (and stores nothing) when the device is full. */
  enqueue(record: NewRecord): Promise<boolean> {
    return this.serial(async () => {
      const key = `${this.rowPrefix}${record.client_uuid}`;
      if ((await this.store.getItem(key)) !== null) return true; // idempotent on our side too
      const keys = await this.rowKeys();
      if (keys.length >= OUTBOX_CAPACITY) {
        log.warn('outbox.full', { size: keys.length });
        return false;
      }
      const row = { ...record, attempts: 0, status: 'pending', seq: this.nextSeq() } as OutboxRecord;
      await this.store.setItem(key, JSON.stringify(row));
      this.emit();
      return true;
    });
  }

  /** Every row, in the order it was stored. */
  async list(): Promise<OutboxRecord[]> {
    const keys = await this.rowKeys();
    const rows: OutboxRecord[] = [];
    const CHUNK = 200;
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = keys.slice(i, i + CHUNK);
      const values = await this.store.multiGet(slice);
      values.forEach((raw, j) => {
        if (!raw) return;
        try {
          rows.push(JSON.parse(raw) as OutboxRecord);
        } catch (e) {
          log.error('outbox.row_corrupt', { key: slice[j], e });
        }
      });
    }
    rows.sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0) || x.created_at.localeCompare(y.created_at) || x.monotonic_ms - y.monotonic_ms);
    return rows;
  }

  async size(): Promise<number> {
    return (await this.rowKeys()).length;
  }

  /** Removes rows the server accepted (and only those). */
  acknowledge(clientUuids: readonly string[]): Promise<void> {
    return this.serial(async () => {
      for (const id of clientUuids) await this.store.removeItem(`${this.rowPrefix}${id}`);
      this.emit();
    });
  }

  /** Marks rows the server refused; they stay, visible in Settings (brief §11 conflict surface). */
  markRejected(rejections: readonly { client_uuid: string; type: string; request_id: string | null }[]): Promise<void> {
    return this.serial(async () => {
      for (const r of rejections) {
        const key = `${this.rowPrefix}${r.client_uuid}`;
        const raw = await this.store.getItem(key);
        if (!raw) continue;
        const row = JSON.parse(raw) as OutboxRecord;
        row.status = 'rejected';
        row.attempts += 1;
        row.last_error = { type: r.type, request_id: r.request_id, at: new Date().toISOString() };
        await this.store.setItem(key, JSON.stringify(row));
      }
      this.emit();
    });
  }

  /** Deletes every row — only from "Delete everything on this device". */
  clear(): Promise<void> {
    return this.serial(async () => {
      for (const key of await this.rowKeys()) await this.store.removeItem(key);
      // The index key earlier versions kept, if this device still has one.
      await this.store.removeItem(`${this.prefix}:index`);
      this.emit();
    });
  }
}
