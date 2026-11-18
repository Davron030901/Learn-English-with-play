import type { CefrLevel, Item } from '@/content/schemas';

/**
 * Listening scaffolds by level. The level always comes from the *unit* (brief §17.1).
 *
 * Speeds (docs/06 §1.1): 1.0× and 0.75× for every listening item, plus 0.5× at A1–A2.
 * Replays (DECISIONS F16, docs/09 §3): unlimited below B2.1 (plays still counted); from B2.1 the
 *   item's `plays_allowed`.
 * Transcripts (DECISIONS F17, docs/06 §1.1), for comprehension listening only — never where the
 *   text is the answer (dictation, spelling_bee, minimal pairs, phoneme_id, stress_tap):
 *   A1.1 shown · A1.2 on demand · A2.1 after the 1st listen · A2.2 after the 2nd ·
 *   B1.1–B2.1 after the task · B2.2–C1 on demand · C2 none.
 */
export function speedsFor(cefr: CefrLevel): number[] {
  return cefr.startsWith('A') ? [1, 0.75, 0.5] : [1, 0.75];
}

const LEVEL_ORDER: readonly CefrLevel[] = ['A1.1', 'A1.2', 'A2.1', 'A2.2', 'B1.1', 'B1.2', 'B2.1', 'B2.2', 'C1', 'C2'];
export const atOrAbove = (cefr: CefrLevel, min: CefrLevel) => LEVEL_ORDER.indexOf(cefr) >= LEVEL_ORDER.indexOf(min);

export function playsCap(item: Item, cefr: CefrLevel): number | null {
  if (!atOrAbove(cefr, 'B2.1')) return null;
  return item.constraints.plays_allowed ?? null;
}

export type TranscriptMode = 'shown' | 'on_demand' | 'after_1' | 'after_2' | 'after_task' | 'none';

const COMPREHENSION = new Set(['listen_gist_mcq', 'listen_detail_gap', 'listen_order_events']);

export function transcriptMode(item: Item, cefr: CefrLevel, noAudio: boolean): TranscriptMode {
  if (!COMPREHENSION.has(item.type_id)) return 'none';
  if (noAudio) return 'shown';
  switch (cefr) {
    case 'A1.1':
      return 'shown';
    case 'A1.2':
      return 'on_demand';
    case 'A2.1':
      return 'after_1';
    case 'A2.2':
      return 'after_2';
    case 'B1.1':
    case 'B1.2':
    case 'B2.1':
      return 'after_task';
    case 'B2.2':
    case 'C1':
      return 'on_demand';
    case 'C2':
      return 'none';
  }
}

export function transcriptVisible(mode: TranscriptMode, plays: number, requested: boolean, answered: boolean): boolean {
  switch (mode) {
    case 'shown':
      return true;
    case 'on_demand':
      return requested;
    case 'after_1':
      return plays >= 1 && requested;
    case 'after_2':
      return plays >= 2 && requested;
    case 'after_task':
      return answered;
    case 'none':
      return false;
  }
}

/**
 * Timers (DECISIONS F15, docs/09 §6): below B2 no countdown unless the learner opted into timed
 * practice; from B2 the item's own value. The games keep their clock — the clock is the game —
 * unless timers are off (their untimed practice variant). Every limit can be doubled or removed
 * (WCAG 2.2.1). Speaking uses its limit as the recording's maximum length.
 */
export function timerSeconds(
  item: Item,
  cefr: CefrLevel,
  prefs: { timers: 'default' | 'double' | 'off'; timedMode: boolean },
): number | null {
  const base = item.constraints.max_seconds;
  if (!base || prefs.timers === 'off') return null;
  const game = item.type_id === 'memory_match' || item.type_id === 'word_race';
  const speaking = ['repeat_after', 'read_aloud', 'speak_prompt', 'speak_roleplay', 'speak_retell'].includes(item.type_id);
  if (!game && !speaking && !atOrAbove(cefr, 'B2.1') && !prefs.timedMode) return null;
  return prefs.timers === 'double' ? base * 2 : base;
}
