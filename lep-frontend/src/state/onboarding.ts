import { create } from 'zustand';

/**
 * The onboarding answers before an account exists. Memory only: nothing here is written to the
 * device, and the birth year is cleared the moment the server (or the early check) refuses it —
 * it is never stored or logged (brief §9, DECISIONS §7.4).
 */
export interface OnboardingDraft {
  birthYear: number | null;
  /** The early kind stop was shown this run; the age question is not offered again. */
  refused: boolean;
  why: string | null;
  l1: string | null;
  spellingVariant: 'us' | 'uk';
  level: 'none' | 'some' | 'lot' | null;
  startSection: number;
  dailyGoal: 5 | 10 | 20 | 40;
  plan: { cue: 'afterBreakfast' | 'commute' | 'lunch' | 'work' | 'dinner'; hour: number; minute: number; remind: boolean } | null;
  startedAt: number | null;
  /** Set when the account was just created: the next screen is the first spoken sentence. */
  pendingFirstSentence: boolean;
  /** Step 7 was shown this run. Account creation redirects to it otherwise (docs/10 §11). */
  sawExpectations: boolean;
}

const EMPTY: OnboardingDraft = {
  birthYear: null,
  refused: false,
  why: null,
  l1: null,
  spellingVariant: 'us',
  level: null,
  startSection: 1,
  dailyGoal: 10,
  plan: null,
  startedAt: null,
  pendingFirstSentence: false,
  sawExpectations: false,
};

interface Store extends OnboardingDraft {
  set: (patch: Partial<OnboardingDraft>) => void;
  refuse: () => void;
  reset: () => void;
}

export const useOnboarding = create<Store>((set) => ({
  ...EMPTY,
  set: (patch) => set(patch),
  refuse: () => set({ birthYear: null, refused: true }),
  reset: () => set({ ...EMPTY }),
}));

/**
 * The early, kind stop for under-13s (DECISIONS F21). It mirrors the server's rule so a child is
 * not walked through seven steps first; the server's refusal at registration is authoritative
 * (DECISIONS §7.4). Only the birth year is known, so — like the server — refuse whenever the
 * learner *might* be under 13.
 */
export function mightBeUnder13(birthYear: number, today: Date = new Date()): boolean {
  const oldest = today.getFullYear() - birthYear;
  return oldest - 1 < 13;
}
