import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { publicApi } from '@/api/client';
import { serverOperations } from '@/api/paths.generated';
import { log } from '@/lib/log';
import { CLIENT_EVENTS, readCounts, subtractCounts, type EventCounts } from '@/state/clientEvents';

/**
 * Sends the device's event counts to POST /v1/client-events (frontend DECISIONS §23) — at
 * start-up and on return to the foreground, when the server has the route. Only what the server
 * accepted is taken off the counts; a failure keeps them for next time. Never in anyone's way.
 */
export const serverHasClientEvents = (serverOperations as readonly string[]).includes(
  'POST /v1/client-events',
);

const PLATFORMS = new Set(['ios', 'android', 'web']);

function appVersion(): string {
  const v = Constants.expoConfig?.version ?? '0.0.0';
  return /^[0-9A-Za-z.+-]{1,32}$/.test(v) ? v : '0.0.0';
}

export async function flushClientEvents(): Promise<void> {
  if (!serverHasClientEvents || !PLATFORMS.has(Platform.OS)) return;
  const counts = await readCounts();
  const events = CLIENT_EVENTS.flatMap((name) => {
    const count = counts[name] ?? 0;
    return count > 0 ? [{ name, count }] : [];
  });
  if (events.length === 0) return;
  try {
    const result = await publicApi.POST('/v1/client-events', {
      body: {
        platform: Platform.OS as 'ios' | 'android' | 'web',
        app_version: appVersion(),
        events,
      },
    });
    if (!result.response.ok) {
      log.info('client_events.refused', { status: result.response.status });
      return;
    }
    const sent: EventCounts = {};
    for (const e of events) sent[e.name] = e.count;
    await subtractCounts(sent);
  } catch (e) {
    log.info('client_events.not_sent', { message: String(e) });
  }
}
