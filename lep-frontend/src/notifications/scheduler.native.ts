import * as Notifications from 'expo-notifications';

/**
 * The phone's local notification scheduler (iOS, Android). Local notifications only: no push
 * token is requested or sent anywhere — the server does not send reminders (docs/10 §7).
 */
export const schedulerSupported = true;

export async function cancelAll(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function requestPermission(): Promise<boolean> {
  const perm = await Notifications.requestPermissionsAsync();
  return perm.granted;
}

export async function schedule(at: { hour: number; minute: number; weekday?: number }, title: string, body: string): Promise<void> {
  const trigger: Notifications.NotificationTriggerInput =
    at.weekday !== undefined
      ? { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: at.weekday, hour: at.hour, minute: at.minute }
      : { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: at.hour, minute: at.minute };
  await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger });
}
