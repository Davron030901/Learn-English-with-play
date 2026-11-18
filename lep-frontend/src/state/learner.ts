import { create } from 'zustand';

import type { Tier } from '@/content/model';

import { readJson, removeKeysWithPrefix, writeJson } from './storage';

/**
 * What this device knows about the learner's own work — facts, not statistics:
 *   * which node-tiers they finished *on this device* (drawn as pips on the path);
 *   * where they chose to start; the words they saved from stories; their onboarding answers.
 * No level, mastery, streak or XP is ever derived from this (brief §4.4, §8.4 guardrail 9).
 * Keyed by learner id so two accounts on one device never mix.
 */
export interface SavedWord {
  lexemeId: string;
  lemma: string;
  savedAt: string;
}

export interface OnboardingAnswers {
  why: string | null;
  level: 'none' | 'some' | 'lot' | null;
  plan: { cue: string; hour: number; minute: number } | null;
  /** Launch-to-first-sentence and step-8 timing, measured for the 90-second target (F21). */
  firstSentenceMs: number | null;
}

export interface LearnerData {
  /** Display preferences copied from /v1/me so lessons work offline (never is_minor or birth year). */
  profile: { l1: string; spellingVariant: 'us' | 'uk' } | null;
  completed: Record<string, Partial<Record<Tier, string>>>;
  startSection: number;
  savedWords: SavedWord[];
  onboarding: OnboardingAnswers;
  lastSessionId: string | null;
}

export const EMPTY_LEARNER: LearnerData = {
  profile: null,
  completed: {},
  startSection: 1,
  savedWords: [],
  onboarding: { why: null, level: null, plan: null, firstSentenceMs: null },
  lastSessionId: null,
};

const LAST_LEARNER_KEY = 'lep:last_learner';
const keyFor = (id: string) => `lep:learner:${id}`;

interface LearnerStore {
  learnerId: string | null;
  data: LearnerData;
  loaded: boolean;
  load: (learnerId: string) => Promise<void>;
  update: (fn: (d: LearnerData) => LearnerData) => void;
  markCompleted: (nodeId: string, tier: Tier) => void;
  toggleSavedWord: (w: { lexemeId: string; lemma: string }) => void;
  forget: () => void;
  wipe: () => Promise<void>;
}

export const useLearner = create<LearnerStore>((set, get) => ({
  learnerId: null,
  data: EMPTY_LEARNER,
  loaded: false,
  load: async (learnerId) => {
    if (get().learnerId === learnerId && get().loaded) return;
    const stored = await readJson<Partial<LearnerData>>(keyFor(learnerId), {});
    set({ learnerId, data: { ...EMPTY_LEARNER, ...stored, onboarding: { ...EMPTY_LEARNER.onboarding, ...stored.onboarding } }, loaded: true });
    await writeJson(LAST_LEARNER_KEY, learnerId);
  },
  update: (fn) => {
    const { learnerId, data } = get();
    const next = fn(data);
    set({ data: next });
    if (learnerId) void writeJson(keyFor(learnerId), next);
  },
  markCompleted: (nodeId, tier) =>
    get().update((d) => ({
      ...d,
      completed: { ...d.completed, [nodeId]: { ...d.completed[nodeId], [tier]: new Date().toISOString() } },
    })),
  toggleSavedWord: (w) =>
    get().update((d) => {
      const has = d.savedWords.some((s) => s.lexemeId === w.lexemeId);
      return {
        ...d,
        savedWords: has
          ? d.savedWords.filter((s) => s.lexemeId !== w.lexemeId)
          : [...d.savedWords, { ...w, savedAt: new Date().toISOString() }],
      };
    }),
  forget: () => {
    set({ learnerId: null, data: EMPTY_LEARNER, loaded: false });
    void writeJson(LAST_LEARNER_KEY, null);
  },
  wipe: async () => {
    const id = get().learnerId;
    set({ learnerId: null, data: EMPTY_LEARNER, loaded: false });
    await removeKeysWithPrefix('lep:learner:');
    if (id) await removeKeysWithPrefix(`lep:outbox:${id}`);
    await writeJson(LAST_LEARNER_KEY, null);
  },
}));

/** The learner id used last on this device, so progress loads offline before /v1/me answers. */
export function lastLearnerId(): Promise<string | null> {
  return readJson<string | null>(LAST_LEARNER_KEY, null);
}

export function completedMap(data: LearnerData): Map<string, Tier[]> {
  const m = new Map<string, Tier[]>();
  for (const [nodeId, tiers] of Object.entries(data.completed)) {
    m.set(
      nodeId,
      (Object.keys(tiers) as unknown as string[]).map((t) => Number(t) as Tier).filter((t) => t === 1 || t === 2 || t === 3),
    );
  }
  return m;
}
