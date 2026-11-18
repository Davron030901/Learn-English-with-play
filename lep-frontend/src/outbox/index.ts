import { useEffect, useState } from 'react';

import { deviceStore } from '@/state/storage';

import { Outbox, type OutboxRecord } from './outbox';

const boxes = new Map<string, Outbox>();

export function getOutbox(learnerId: string): Outbox {
  let box = boxes.get(learnerId);
  if (!box) {
    box = new Outbox(deviceStore, learnerId);
    boxes.set(learnerId, box);
  }
  return box;
}

/** Live view of the outbox for the Settings conflict surface. */
export function useOutboxRows(learnerId: string | null): OutboxRecord[] {
  const [rows, setRows] = useState<OutboxRecord[]>([]);
  useEffect(() => {
    if (!learnerId) return;
    const box = getOutbox(learnerId);
    let alive = true;
    const refresh = () => {
      void box.list().then((r) => alive && setRows(r));
    };
    refresh();
    const unsub = box.subscribe(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, [learnerId]);
  return rows;
}
