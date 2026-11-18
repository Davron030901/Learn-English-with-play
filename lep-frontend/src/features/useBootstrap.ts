import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform } from 'react-native';

import { session, transport } from '@/api/client';
import { send } from '@/api/transport';
import { useAuthStatus, useMe } from '@/api/queries/me';
import { content } from '@/content/queries';
import { flushClientEvents } from '@/features/clientEvents';
import { refreshDueWindow } from '@/features/garden/offlineWindow';
import { useA11yProfileSync } from '@/features/settings/useA11yProfileSync';
import { log } from '@/lib/log';
import { getOutbox } from '@/outbox';
import { cancelReminders } from '@/notifications/reminders';
import { scheduleSync, syncNow } from '@/outbox/syncer';
import { lastLearnerId, useLearner } from '@/state/learner';
import { useOnlineStore } from '@/state/online';
import { DEFAULT_REMINDERS, usePrefs } from '@/state/prefs';

import { reminderUpkeep } from './reminderUpkeep';

/**
 * App-wide wiring that is not a screen:
 *   * the platform's network status feeds the one `online` state;
 *   * the stored session is restored at launch (signed in at once when a refresh token exists);
 *   * the learner's device data loads from the last learner id, so the path works offline
 *     before /v1/me answers, and is confirmed against /v1/me when it does;
 *   * signing out clears every server-derived cache (never persisted in the first place);
 *   * the outbox is offered to the server whenever the app comes online (it waits until the
 *     server has somewhere to put it — see outbox/sync.ts), and the next seven days of reviews
 *     are then saved for watering offline (features/garden/offlineWindow.ts);
 *   * the account's copy of the accessibility profile is brought in line with this device's;
 *   * the device's event counts (frontend DECISIONS §23) are sent when the server is reachable;
 *   * reminders are kept honest each time the app comes to the foreground.
 */
export function useBootstrap() {
  const { t } = useTranslation();
  const status = useAuthStatus();
  const me = useMe();
  const queryClient = useQueryClient();
  const load = useLearner((s) => s.load);
  const forget = useLearner((s) => s.forget);
  const network = useOnlineStore((s) => s.network);

  useEffect(() => {
    void session.restore();
    void content.startupChecks().catch((e: unknown) => log.error('content.startup_failed', e));
    const unsubscribe = NetInfo.addEventListener((s) => {
      useOnlineStore.getState().setNetwork(s.isConnected !== false);
    });
    // On the web NetInfo follows navigator.connection where the browser has it, which does not
    // report going offline; the window's own events do.
    const onWindow = () => useOnlineStore.getState().setNetwork(navigator.onLine);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('online', onWindow);
      window.addEventListener('offline', onWindow);
    }
    return () => {
      unsubscribe();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('online', onWindow);
        window.removeEventListener('offline', onWindow);
      }
    };
  }, []);

  // TanStack Query has no window events on native: tell it when the network comes back (so
  // /v1/me refetches after an offline start) and when the app returns to the foreground.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    onlineManager.setEventListener((setOnline) =>
      NetInfo.addEventListener((s) => setOnline(s.isConnected !== false)),
    );
    const sub = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, []);

  // "We'll reconnect by ourselves" (offline.body): while the network is up but the server did not
  // answer, ask it again every 15 s — any answer at all clears the offline state.
  const serverReachable = useOnlineStore((s) => s.serverReachable);
  useEffect(() => {
    if (!network || serverReachable) return;
    const probe = () => {
      void send(transport, { method: 'GET', path: '/health', retries: 0, timeoutMs: 8_000 }).catch(
        () => undefined,
      );
    };
    probe();
    const id = setInterval(probe, 15_000);
    return () => clearInterval(id);
  }, [network, serverReachable]);

  useEffect(() => {
    if (status === 'signedIn') {
      void lastLearnerId().then((id) => {
        if (id && !useLearner.getState().loaded) void load(id);
      });
    }
    if (status === 'signedOut') {
      queryClient.removeQueries({ queryKey: ['me'] });
      forget();
      // Reminders belong to the person who set them: none fire for whoever signs in next, and a
      // signed-out device sends none at all (the setting is behind the sign-in).
      void cancelReminders();
      if (usePrefs.getState().reminders.enabled)
        usePrefs.getState().setReminders({ ...DEFAULT_REMINDERS });
    }
  }, [status, load, forget, queryClient]);

  // The learner's device data is keyed the moment a session exists — from the token the server
  // just issued — so an answer is never left without an owner while /v1/me is slow or down.
  useEffect(() => session.onLearner((id) => void load(id)), [load]);

  useEffect(() => {
    const data = me.data;
    if (!data?.id) return;
    void load(data.id).then(() => {
      const variant = data.settings.spelling_variant === 'uk' ? 'uk' : 'us';
      const cur = useLearner.getState().data.profile;
      if (!cur || cur.l1 !== data.l1 || cur.spellingVariant !== variant) {
        useLearner
          .getState()
          .update((d) => ({ ...d, profile: { l1: data.l1, spellingVariant: variant } }));
      }
    });
  }, [me.data, load]);

  // The account's copy of the accessibility profile follows this device's switches.
  useA11yProfileSync();

  // The device's event counts (F2) go to the server when it can be reached, signed in or not.
  useEffect(() => {
    if (!network) return;
    void flushClientEvents();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void flushClientEvents();
    });
    return () => sub.remove();
  }, [network]);

  // `is_minor` is read from the live response each time and never stored (brief §4.1). An app
  // opened offline still counts as opened: until /v1/me answers, the stricter minor schedule is
  // assumed rather than skipping the upkeep (which used to cut reminders to weekly for learners
  // who had in fact opened the app).
  const minor = me.data?.is_minor ?? true;
  useEffect(() => {
    if (status !== 'signedIn') return;
    const run = () =>
      reminderUpkeep(minor, (cue) =>
        t('onboarding.plan.reminderText', { cue: t(`onboarding.plan.${cue}`) }),
      );
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, [status, minor, t]);

  // The outbox is offered to the server when the learner or the network changes, shortly after
  // any answer is stored (debounced), and when the app comes back to the foreground. After the
  // first two, the reviews due in the next seven days are saved for watering offline — once the
  // outbox is in, so the window already counts what was just answered.
  const learnerId = useLearner((s) => s.learnerId);
  useEffect(() => {
    if (!learnerId || !network || status !== 'signedIn') return;
    const syncAndSave = () =>
      void syncNow(learnerId)
        .then(() => refreshDueWindow(learnerId))
        .catch((e: unknown) => log.info('due_window.refresh_failed', e));
    syncAndSave();
    const unsub = getOutbox(learnerId).subscribe(() => scheduleSync(learnerId));
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') syncAndSave();
    });
    return () => {
      unsub();
      sub.remove();
    };
  }, [learnerId, network, status]);
}
