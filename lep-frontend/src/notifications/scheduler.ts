/**
 * The web (and Node test) scheduler: there is none. A web page cannot fire a reminder at a set
 * time once it is closed, so the web build sends no reminders at all and says so in Settings —
 * and it does not load expo-notifications, whose web module only warns.
 */
export const schedulerSupported = false;

export function cancelAll(): Promise<void> {
  return Promise.resolve();
}

export function requestPermission(): Promise<boolean> {
  return Promise.resolve(false);
}

export function schedule(_at: { hour: number; minute: number; weekday?: number }, _title: string, _body: string): Promise<void> {
  return Promise.resolve();
}
