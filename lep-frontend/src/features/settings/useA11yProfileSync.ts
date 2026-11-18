import { useEffect, useRef } from 'react';

import {
  a11yDrift,
  noteA11yCopy,
  saveA11yProfile,
  serverHasSettings,
} from '@/api/queries/gamification';
import { useMe } from '@/api/queries/me';
import { usePrefs } from '@/state/prefs';

/**
 * Keeps the account's copy of the accessibility profile in step with this device — the other way
 * round from the theme (useCosmeticSync): the switches decide how exercises are shown here, so the
 * device is the record. The server needs the copy to choose the exercises of the due queue and the
 * offline window. When /v1/me shows a different profile, the device's is sent in the background,
 * once per learner and profile while the app runs; a failure is logged and tried again at the next
 * start. What /v1/me shows is noted for the outbox, which sends the copy ahead of answers when the
 * account is not known to hold it (a11yCopyFirst).
 */
export function useA11yProfileSync(): void {
  const me = useMe();
  const prefsReady = usePrefs((s) => s.hydrated);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    const data = me.data;
    if (!data?.id) return;
    noteA11yCopy(data.id, data.settings);
    if (!prefsReady || !serverHasSettings) return;
    const { noAudio, noVision } = usePrefs.getState();
    const key = `${data.id}:${noAudio}:${noVision}`;
    if (sent.current === key || !a11yDrift({ noAudio, noVision }, data.settings)) return;
    sent.current = key;
    void saveA11yProfile({ noAudio, noVision });
  }, [me.data, prefsReady]);
}
