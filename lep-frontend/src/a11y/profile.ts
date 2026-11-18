import type { TypeId } from '@/content/schemas';

/**
 * docs/00 §6: no exercise type may be the only way to learn an item. A deaf or hard-of-hearing
 * learner needs a non-audio route to every syllabus item; a blind learner a non-visual one
 * (brief §12). The profile goes with every POST /v1/sessions and the account keeps a copy for
 * what the server chooses on its own — reviews, the offline window (DECISIONS F19, §21); the
 * backend's table is the same (app/domain/accessibility.py), and the local composer applies it
 * offline.
 */
export interface AccessibilityProfile {
  noAudio: boolean;
  noVision: boolean;
}

export const DEFAULT_PROFILE: AccessibilityProfile = { noAudio: false, noVision: false };

/**
 * No-audio route (brief §12 table):
 *   * listen_* items are answered against the transcript (the episode script is on screen);
 *   * dictation and spelling_bee show their stem as text — a copy task, the text route;
 *   * minimal pairs and phoneme_id have no text equivalent that tests the same thing: excluded,
 *     their phonology points stay reachable through their explanation and stress_tap.
 */
export const EXCLUDED_WITHOUT_AUDIO: ReadonlySet<TypeId> = new Set(['minimal_pair_discrimination', 'phoneme_id']);
export const TEXT_ROUTE_WITHOUT_AUDIO: ReadonlySet<TypeId> = new Set([
  'dictation_word',
  'dictation_sentence',
  'spelling_bee',
  'listen_gist_mcq',
  'listen_detail_gap',
  'listen_order_events',
]);

/**
 * No-vision route: nothing is excluded — every visual interaction has a linear, announceable
 * equivalent in its renderer (banks and order become "move to position", pairs and memory_match
 * become one list with a picker per word, word_race drops its clock, stress_tap reads the
 * syllables). The composer only drops the visual-memory game in favour of the list form.
 */
export const LIST_ROUTE_WITHOUT_VISION: ReadonlySet<TypeId> = new Set([
  'tap_pairs',
  'memory_match',
  'word_race',
  'sort_bins',
  'word_bank_build',
  'sentence_reorder',
  'listen_order_events',
]);

export function excludedByProfile(type: TypeId, profile: AccessibilityProfile): boolean {
  return profile.noAudio && EXCLUDED_WITHOUT_AUDIO.has(type);
}
