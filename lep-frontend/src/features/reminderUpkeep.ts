import { log } from '@/lib/log';
import { IGNORED_BEFORE_WEEKLY, applyReminders, missedSince, reminderTimes, remindersSupported } from '@/notifications/reminders';
import { usePrefs, type ReminderPrefs } from '@/state/prefs';

/**
 * Runs whenever the app comes to the foreground (docs/10 §7 "never escalate"): reminders that
 * fired while the app stayed closed are counted, and once five in a row went unopened the
 * schedule drops to weekly — Settings then offers to pause them. Opening the app sooner resets
 * the count. Never more reminders, never louder ones.
 */
export function reminderUpkeep(minor: boolean, textFor: (cue: ReminderPrefs['cue']) => string, now: Date = new Date()): Partial<ReminderPrefs> {
  const { reminders: r, setReminders } = usePrefs.getState();
  const patch: Partial<ReminderPrefs> = { lastOpenedAt: now.toISOString() };
  if (remindersSupported && r.enabled && !r.paused && !r.weekly && r.lastOpenedAt) {
    const missed = missedSince(new Date(r.lastOpenedAt), now, reminderTimes(r, minor));
    if (missed >= IGNORED_BEFORE_WEEKLY) {
      patch.weekly = true;
      patch.ignoredInARow = missed;
      void applyReminders({ ...r, ...patch }, textFor(r.cue), minor).catch((e: unknown) => log.warn('reminders.apply_failed', e));
      log.info('reminders.cut_to_weekly', { missed });
    } else {
      patch.ignoredInARow = 0;
    }
  }
  setReminders(patch);
  return patch;
}
