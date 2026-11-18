import type { FunctionPoint, GrammarPoint, Item, Story } from '@/content/schemas';
import type { Lexeme } from '@/content/model';

/**
 * docs/07 §3.2, the mandatory session shape (brief §6.1):
 *
 *   1 WARM-UP 60–90 s · 2 REVIEW 2–3 min · 3 NEW INPUT 1–2 min (no testing) ·
 *   4 GUIDED 2–3 min · 5 INTEGRATION 1–2 min · 6 PRODUCTION 1–2 min · 7 CLOSE 20 s
 *
 * The server composes node-tier sessions (POST /v1/sessions, runner/serverSession.ts) — REVIEW
 * then holds the due items its scheduler chose. Offline, or when the server cannot be asked,
 * the runner composes locally from the node-tier (runner/compose.ts) and REVIEW is empty.
 */
export const PHASES = ['warmup', 'review', 'new_input', 'guided', 'integration', 'production', 'close'] as const;
export type Phase = (typeof PHASES)[number];

export type PresentCard =
  | { type: 'lexeme'; lexeme: Lexeme }
  | { type: 'grammar'; point: GrammarPoint }
  | { type: 'function'; fn: FunctionPoint }
  | { type: 'story'; story: Story };

export type Step =
  | { kind: 'present'; phase: 'new_input'; card: PresentCard }
  | { kind: 'item'; phase: Exclude<Phase, 'new_input' | 'close'>; item: Item; recovery?: boolean }
  | { kind: 'break' }
  | { kind: 'close' };

/** Session length after which a 15-second break is offered (docs/07 §3.3). */
export const BREAK_AFTER_MS = 12 * 60_000;
export const BREAK_SECONDS = 15;
