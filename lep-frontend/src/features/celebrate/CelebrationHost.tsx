import { useCallback, useEffect, useState } from 'react';

import { useGamificationSummary, useMarkBadgesSeen } from '@/api/queries/gamification';
import { useAwards } from '@/state/awards';

import { CelebrationOverlay } from './CelebrationOverlay';
import { badgesOf, celebrationsFrom, stampsCelebration, useCelebrations } from './queue';

/**
 * Shows the queued celebrations while `active` (docs/16 E12 §4): at most `max` in a row — two after
 * a lesson — and the rest the next time a host becomes active (the path, at the next app open).
 * Sources, all from the server: awards a sync handed back (`useAwards`) and, where
 * `includeUnseen`, stamps the summary still lists as unseen (earned on another device, or while
 * the app was closed). Each stamp is reported seen once it has been shown, so it never repeats.
 *
 * The celebration on screen is simply the head of the queue: it leaves the queue when the learner
 * closes it. A host that stops being active (the screen lost focus) hides it without losing it.
 */
export function CelebrationHost({ active, includeUnseen = false, max = 2 }: { active: boolean; includeUnseen?: boolean; max?: number }) {
  const head = useCelebrations((s) => s.pending[0] ?? null);
  const add = useCelebrations((s) => s.add);
  const shift = useCelebrations((s) => s.shift);
  const { mutate: markSeen } = useMarkBadgesSeen();
  const summary = useGamificationSummary();
  const unseen = includeUnseen ? summary.data?.unseen_badges : undefined;

  // How many were shown since this host last became active; a new activation starts again at 0.
  const [run, setRun] = useState({ active, shown: 0 });
  if (run.active !== active) setRun({ active, shown: 0 });
  const shown = run.active === active ? run.shown : 0;

  // Awards: take what is queued now, and whatever arrives while this host is active.
  useEffect(() => {
    if (!active) return;
    const pull = () => {
      const taken = useAwards.getState().takeCelebrations();
      if (taken.length) add(celebrationsFrom(taken));
    };
    pull();
    return useAwards.subscribe((s, prev) => {
      if (s.queue !== prev.queue && s.queue.length) pull();
    });
  }, [active, add]);

  useEffect(() => {
    if (active && unseen?.length) add([stampsCelebration(unseen)]);
  }, [active, unseen, add]);

  const current = active && shown < max ? head : null;

  const done = useCallback(() => {
    if (!current) return;
    const ids = badgesOf(current).map((b) => b.id);
    if (ids.length) markSeen(ids, { onError: () => undefined });
    shift();
    setRun((r) => ({ ...r, shown: r.shown + 1 }));
  }, [current, markSeen, shift]);

  return current ? <CelebrationOverlay key={current.key} celebration={current} onDone={done} /> : null;
}
