import type { AccessibilityProfile } from '@/a11y/profile';
import type { Accent } from '@/audio/speech';
import type { Unit } from '@/content/model';
import type { CefrLevel, Item } from '@/content/schemas';
import type { GradeResult, Submission } from '@/grading/grade';
import type { Hint } from '@/grading/hints';
import type { Speed, TimerPreference } from '@/state/prefs';

export interface ExerciseContext {
  unit: Unit;
  /** The level comes from the unit, never from `item.cefr` (brief §17.1). */
  cefr: CefrLevel;
  l1: string;
  english: ReadonlySet<string>;
  profile: AccessibilityProfile;
  accent: Accent;
  speed: Speed;
  timers: TimerPreference;
  timedMode: boolean;
  whisper: boolean;
  /** Seed for per-presentation option order (docs/09 §4.1). */
  seed: number;
  reduceMotion: boolean;
}

export interface ExerciseProps<I extends Item = Item> {
  item: I;
  ctx: ExerciseContext;
  /** Set once the answer was submitted: the renderer shows right/wrong and stops accepting input. */
  result: GradeResult | null;
  plays: number;
  onPlay: () => void;
  hint: Hint | null;
  onSubmit: (submission: Submission) => void;
  /**
   * Games whose clock can run out register what the learner has done so far; the runner submits it
   * instead of a bare timeout, so matches made before time ran out are kept (audit 2026-10-03).
   */
  onPartial?: (provider: (() => Submission | null) | null) => void;
}
