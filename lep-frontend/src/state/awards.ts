import { create } from 'zustand';

import type { AwardsOut } from '@/api/types';

/**
 * Awards the server granted for synced answers (docs/16 E00), waiting to be shown: the lesson-end
 * summary reads the latest, celebrations take theirs once. Memory only — the server is the record
 * and `GET /v1/gamification/summary` restores the numbers on any device.
 */
interface AwardsStore {
  /** The most recent non-empty awards, with when they arrived. */
  latest: { awards: AwardsOut; at: number } | null;
  /** Celebrations not yet shown: units, sections, stamps, streak milestones, quests. */
  queue: AwardsOut[];
  push: (awards: AwardsOut) => void;
  takeCelebrations: () => AwardsOut[];
  clear: () => void;
}

export function isEmptyAward(a: AwardsOut): boolean {
  return (
    a.xp === 0 &&
    a.gems === 0 &&
    !(a.goal?.met_now ?? false) &&
    !a.streak?.milestone_now &&
    a.quests_completed.length === 0 &&
    a.nodes_completed.length === 0 &&
    a.units_completed.length === 0 &&
    a.sections_completed.length === 0 &&
    a.badges.length === 0
  );
}

function celebrates(a: AwardsOut): boolean {
  return a.units_completed.length > 0 || a.sections_completed.length > 0 || a.badges.length > 0 || Boolean(a.streak?.milestone_now);
}

export const useAwards = create<AwardsStore>()((set, get) => ({
  latest: null,
  queue: [],
  push: (awards) => {
    if (isEmptyAward(awards)) return;
    set((s) => ({ latest: { awards, at: Date.now() }, queue: celebrates(awards) ? [...s.queue, awards] : s.queue }));
  },
  takeCelebrations: () => {
    const q = get().queue;
    set({ queue: [] });
    return q;
  },
  clear: () => set({ latest: null, queue: [] }),
}));
