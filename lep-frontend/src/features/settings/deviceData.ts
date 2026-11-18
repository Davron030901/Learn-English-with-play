import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { session } from '@/api/client';
import { discardAllRecordings } from '@/audio/useRecorder';
import { contentVersion } from '@/content/version.generated';
import { log } from '@/lib/log';
import { cancelReminders } from '@/notifications/reminders';
import { getOutbox } from '@/outbox';
import { useLearner } from '@/state/learner';
import { DEFAULT_PREFS, usePrefs, type Prefs } from '@/state/prefs';
import { removeKeysWithPrefix } from '@/state/storage';

/**
 * The learner's data exit (brief §8.4 guardrail 10: export and delete within three taps of Me).
 *
 * The export is everything about the learner, as JSON: the account's own copy on the server
 * (GET /v1/me/export — every row the server keeps, recordings included, secrets left out) when
 * it could be fetched, and everything *this device* holds: device preferences, the progress
 * recorded here, saved words, onboarding answers and every answer still waiting in the outbox.
 * It never contains a token (those live only in the platform keystore and are not read here).
 */
export type AccountCopy = { data: unknown } | { unavailable: 'offline' | 'failed' | 'not_offered' };

export async function buildExport(now: Date = new Date(), account: AccountCopy = { unavailable: 'not_offered' }): Promise<string> {
  const prefsState = usePrefs.getState();
  const prefs: Prefs = (Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]).reduce<Prefs>(
    (acc, k) => ({ ...acc, [k]: prefsState[k] }),
    { ...DEFAULT_PREFS },
  );
  const { learnerId, data } = useLearner.getState();
  const outbox = learnerId ? await getOutbox(learnerId).list() : [];
  return JSON.stringify(
    {
      format: 'lep-device-export/1',
      exported_at: now.toISOString(),
      content_version: contentVersion,
      learner_id: learnerId,
      device_preferences: prefs,
      progress_on_this_device: {
        completed: data.completed,
        start_section: data.startSection,
        saved_words: data.savedWords,
        onboarding: data.onboarding,
      },
      unsent_answers: outbox,
      account_on_server: 'data' in account ? account.data : null,
      ...('data' in account
        ? {}
        : {
            note:
              account.unavailable === 'not_offered'
                ? 'This server does not offer an export of your account; ask support for it.'
                : "Your account's copy on the server could not be fetched just now (offline, or the server did not answer). Export again when you are online.",
          }),
    },
    null,
    2,
  );
}

/** Hands the export to the learner: a download on the web, the share sheet on a phone. */
export async function saveExport(json: string, now: Date = new Date()): Promise<'saved' | 'unavailable'> {
  const name = `learn-english-with-play-${now.toISOString().slice(0, 10)}.json`;
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'saved';
  }
  const file = new File(Paths.cache, name);
  try {
    if (!(await Sharing.isAvailableAsync())) return 'unavailable';
    file.create({ overwrite: true });
    file.write(json);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: name, UTI: 'public.json' });
    return 'saved';
  } finally {
    // The copy holds unsent answers: it lives only as long as the share sheet needs it.
    removeExportFile(file);
  }
}

function removeExportFile(file: File) {
  try {
    if (file.exists) file.delete();
  } catch (e) {
    log.warn('privacy.export_cleanup_failed', e);
  }
}

/**
 * "Delete everything on this device": progress, saved words, unsent answers, preferences,
 * recordings, scheduled reminders and the local log — then sign out. The account itself is not
 * touched (the server offers no deletion endpoint yet; the screen says how to ask for it).
 */
export async function deleteEverythingOnDevice(): Promise<void> {
  const { learnerId } = useLearner.getState();
  try {
    if (learnerId) await getOutbox(learnerId).clear();
    await useLearner.getState().wipe();
    discardAllRecordings();
    await cancelReminders();
    await removeKeysWithPrefix('lep:');
    usePrefs.getState().reset();
    log.clear();
  } finally {
    await session.signOut('user');
  }
}
