import { create } from 'zustand';

import type { AwardsOut, BadgeOut } from '@/api/types';

/**
 * Rare celebrations (docs/16 E12): a unit (small), a section (large), passport stamps, and the
 * streak milestones 7/30/100/365. They come only from the server — awards handed back by a sync,
 * and stamps the server still lists as unseen — and each one is shown once.
 */
export type Celebration =
  | { kind: 'unit'; key: string; unitId: string; badges: BadgeOut[] }
  | { kind: 'stamps'; key: string; badges: BadgeOut[] }
  | { kind: 'section'; key: string; sectionId: string }
  | { kind: 'streak'; key: string; days: number };

/** The celebrations one or more awards carry, smallest first (a unit before its section). */
export function celebrationsFrom(awards: readonly AwardsOut[]): Celebration[] {
  const out: Celebration[] = [];
  for (const a of awards) {
    for (const unitId of a.units_completed) {
      out.push({ kind: 'unit', key: `unit:${unitId}`, unitId, badges: a.badges.filter((b) => b.unit_id === unitId) });
    }
    const loose = a.badges.filter((b) => !a.units_completed.includes(b.unit_id));
    if (loose.length) out.push(stampsCelebration(loose));
    for (const sectionId of a.sections_completed) out.push({ kind: 'section', key: `section:${sectionId}`, sectionId });
    const m = a.streak?.milestone_now;
    if (m) out.push({ kind: 'streak', key: `streak:${m}`, days: m });
  }
  return out;
}

export function stampsCelebration(badges: readonly BadgeOut[]): Celebration {
  return { kind: 'stamps', key: `stamps:${badges.map((b) => b.id).join(',')}`, badges: [...badges] };
}

export function badgesOf(c: Celebration): BadgeOut[] {
  return c.kind === 'unit' || c.kind === 'stamps' ? c.badges : [];
}

interface CelebrationQueue {
  pending: Celebration[];
  /** Keys and badge ids already queued or shown in this app run: nothing is shown twice. */
  known: Set<string>;
  add: (list: readonly Celebration[]) => void;
  shift: () => Celebration | null;
  reset: () => void;
}

export const useCelebrations = create<CelebrationQueue>()((set, get) => ({
  pending: [],
  known: new Set<string>(),
  add: (list) => {
    const known = new Set(get().known);
    const fresh: Celebration[] = [];
    for (const c of list) {
      if (known.has(c.key)) continue;
      if (c.kind === 'stamps') {
        const badges = c.badges.filter((b) => !known.has(`badge:${b.id}`));
        if (!badges.length) continue;
        const next = stampsCelebration(badges);
        if (known.has(next.key)) continue;
        known.add(next.key);
        for (const b of badges) known.add(`badge:${b.id}`);
        fresh.push(next);
        continue;
      }
      known.add(c.key);
      for (const b of badgesOf(c)) known.add(`badge:${b.id}`);
      fresh.push(c);
    }
    if (fresh.length) set((s) => ({ known, pending: [...s.pending, ...fresh] }));
    else set({ known });
  },
  shift: () => {
    const [first, ...rest] = get().pending;
    if (!first) return null;
    set({ pending: rest });
    return first;
  },
  reset: () => set({ pending: [], known: new Set<string>() }),
}));
