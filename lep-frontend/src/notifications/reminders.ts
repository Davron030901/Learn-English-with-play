import { log } from '@/lib/log';
import type { ReminderPrefs } from '@/state/prefs';

import { cancelAll, requestPermission, schedule, schedulerSupported } from './scheduler';

/**
 * Study reminders (docs/10 §7, brief §8.4 guardrail 7, §9 step 6):
 *   * one a day by default, two if the learner opts up, never more than three (hard cap);
 *     a learner who may be under 18 gets one a day at most;
 *   * quiet hours 21:00–08:00 local: nothing is ever scheduled inside them;
 *   * never escalate: after five reminders in a row went unopened, drop to weekly and ask
 *     whether to pause;
 *   * turning them off is one tap, honoured immediately (every scheduled reminder is cancelled).
 * The reminder fires at the exact time the learner chose in onboarding step 6 (an
 * implementation intention), with their own cue in the text.
 */
export const QUIET_FROM_HOUR = 21;
export const QUIET_TO_HOUR = 8;
export const HARD_CAP_PER_DAY = 3;
export const IGNORED_BEFORE_WEEKLY = 5;

export const remindersSupported = schedulerSupported;

export function insideQuietHours(hour: number): boolean {
  return hour >= QUIET_FROM_HOUR || hour < QUIET_TO_HOUR;
}

export function clampToAllowed(hour: number, minute: number): { hour: number; minute: number } {
  if (hour < QUIET_TO_HOUR) return { hour: QUIET_TO_HOUR, minute: 0 };
  if (hour >= QUIET_FROM_HOUR) return { hour: QUIET_FROM_HOUR - 1, minute: 45 };
  return { hour, minute };
}

/** The times a day's reminders fire at: the chosen time, plus one four hours later if opted up. */
export function reminderTimes(prefs: Pick<ReminderPrefs, 'hour' | 'minute' | 'perDay'>, minor: boolean) {
  const perDay = Math.min(minor ? 1 : prefs.perDay, HARD_CAP_PER_DAY);
  const times = [{ hour: prefs.hour, minute: prefs.minute }];
  if (perDay >= 2) {
    const second = prefs.hour + 4;
    if (!insideQuietHours(second)) times.push({ hour: second, minute: prefs.minute });
  }
  return times.filter((t) => !insideQuietHours(t.hour));
}

/**
 * How many reminders went unopened since the app was last opened (each scheduled time that
 * passed while the app stayed closed).
 */
export function missedSince(lastOpened: Date, now: Date, times: readonly { hour: number; minute: number }[]): number {
  let missed = 0;
  const day = new Date(lastOpened);
  day.setHours(0, 0, 0, 0);
  while (day <= now) {
    for (const t of times) {
      const at = new Date(day);
      at.setHours(t.hour, t.minute, 0, 0);
      if (at > lastOpened && at <= now) missed += 1;
    }
    day.setDate(day.getDate() + 1);
    if (missed > 60) break;
  }
  return missed;
}

export async function cancelReminders(): Promise<void> {
  if (!remindersSupported) return;
  try {
    await cancelAll();
  } catch (e) {
    log.warn('reminders.cancel_failed', e);
  }
}

export type ScheduleResult = 'scheduled' | 'denied' | 'unsupported' | 'off';

export async function applyReminders(prefs: ReminderPrefs, text: string, minor: boolean, now: Date = new Date()): Promise<ScheduleResult> {
  if (!remindersSupported) return 'unsupported';
  await cancelReminders();
  if (!prefs.enabled || prefs.paused) return 'off';
  if (!(await requestPermission())) return 'denied';
  const times = reminderTimes(prefs, minor);
  for (const t of times) {
    // Weekly: one reminder, on today's weekday (1 = Sunday in the scheduler's numbering).
    await schedule(prefs.weekly ? { ...t, weekday: 1 + now.getDay() } : t, 'Learn English with Play', text);
    if (prefs.weekly) break;
  }
  return 'scheduled';
}
