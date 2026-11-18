import type { QuestOut, StreakOut } from '@/api/types';
import type { IconName, Tone } from '@/design';

/**
 * Small, pure helpers the HUD, the lesson-end summary and the quests card share. Nothing here
 * computes an award: every number passed in came from the server (docs/16 E00).
 */

/** A quest's title in the interface language (the server sends en, uz and ru). */
export function questTitle(q: Pick<QuestOut, 'title'>, lang: string): string {
  return q.title[lang] ?? q.title.en ?? Object.values(q.title)[0] ?? '';
}

/** The icon tile for a quest metric, in the skill colour where one fits (docs/16 E10). */
export function questLook(metric: string): { icon: IconName; tone: Tone } {
  switch (metric) {
    case 'speaking':
      return { icon: 'mic', tone: 'skill-speak' };
    case 'listening':
      return { icon: 'headphones', tone: 'skill-listen' };
    case 'reviewed_due':
      return { icon: 'refresh', tone: 'lagoon' };
    case 'best_run':
      return { icon: 'bolt', tone: 'xp' };
    case 'correct':
      return { icon: 'target', tone: 'success' };
    case 'answers':
      return { icon: 'check-circle', tone: 'primary' };
    case 'xp':
      return { icon: 'star', tone: 'xp' };
    case 'active_days':
      return { icon: 'calendar', tone: 'streak' };
    default:
      return { icon: 'flag', tone: 'primary' };
  }
}

/** Whole minutes for display: the server keeps tenths; a ring never shows "6.4". */
export function wholeMinutes(m: number): number {
  return Math.max(0, Math.floor(m + 1e-6));
}

/** ISO weekday (1 = Monday) of a calendar date string "YYYY-MM-DD". */
export function isoWeekday(day: string): number {
  const d = new Date(`${day}T12:00:00Z`);
  const w = d.getUTCDay();
  return w === 0 ? 7 : w;
}

export type StreakLook = 'today' | 'open' | 'rest' | 'paused';

/** Which face the streak chip shows today (docs/16 E03 §1). Never red, never "at risk". */
export function streakLook(streak: StreakOut, today: string): StreakLook {
  if (streak.paused_until) return 'paused';
  if (streak.today_counted) return 'today';
  if (streak.rest_days.includes(isoWeekday(today))) return 'rest';
  return 'open';
}

/** The next streak milestone after `current` (7, 30, 100, 365), or null past a year. */
export function nextMilestone(current: number): number | null {
  return [7, 30, 100, 365].find((m) => m > current) ?? null;
}

function intl<T>(make: () => T, fallback: T): T {
  try {
    return make();
  } catch {
    return fallback;
  }
}

/** "14:05" in the learner's language (the snapshot's as_of, docs/16 E00 §3). */
export function clockTime(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return intl(
    () => new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d),
    `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  );
}

/** "14 Oct" for a calendar date (a static date, never a countdown — docs/16 E03). */
export function shortDate(day: string, lang: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return intl(() => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d), day);
}

/** Short weekday names for ISO weekdays (Monday = 1). */
export function weekdayNames(days: readonly number[], lang: string): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((iso) => {
      // 2024-01-01 was a Monday.
      const d = new Date(Date.UTC(2024, 0, iso, 12));
      return intl(() => new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(d), String(iso));
    })
    .join(', ');
}

/** The number in the server's reset message ("… 41 days of learning …"), for the translated copy. */
export function resetDays(message: string): number | null {
  const m = /(\d+)/.exec(message);
  return m?.[1] ? Number(m[1]) : null;
}

/** "7 Oct, 09:00" in the learner's own time: when something opens (a fixed time, not a countdown). */
export function dayAndTime(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return intl(
    () => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d),
    d.toISOString().slice(0, 16).replace('T', ' '),
  );
}
