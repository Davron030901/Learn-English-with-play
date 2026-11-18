import {
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  IOSOutputFormat,
  AudioQuality,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type AudioPlayer,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { log } from '@/lib/log';

import { stopAudio } from './speech';

/**
 * Recording, with the anxiety mitigations of docs/06 §4.5 (brief §7.3):
 *   * private by default — a take leaves the device only to have its pronunciation checked by
 *     the server, when the learner agreed and the server can score (DECISIONS §25), and every
 *     take is deleted from the device when the lesson ends;
 *   * unlimited retakes, only the latest kept;
 *   * no live level meter while recording (metering is off; nothing moves while you speak);
 *   * a text fallback on every speaking task (the renderer offers "Type instead");
 *   * whisper mode (the learner is told to hold the phone close; the flag travels with the answer).
 *
 * 48 kHz mono. Opus where the platform records it (the web's MediaRecorder); AAC on iOS and
 * Android, where expo-audio's encoders do not include Opus.
 */
const OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 48_000,
  numberOfChannels: 1,
  bitRate: 64_000,
  isMeteringEnabled: false,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm;codecs=opus', bitsPerSecond: 64_000 },
};

export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'done' | 'denied' | 'unsupported';

const takes = new Set<string>();

function deleteTake(uri: string) {
  try {
    if (Platform.OS === 'web') URL.revokeObjectURL(uri);
    else new File(uri).delete();
  } catch {
    // already gone
  }
  takes.delete(uri);
}

/** Deletes every recording made in this session (called when a lesson ends). */
export function discardAllRecordings() {
  for (const uri of [...takes]) deleteTake(uri);
}

export function useRecorder(maxSeconds: number | null) {
  const recorder = useAudioRecorder(OPTIONS);
  const status = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [uri, setUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [stoppedByLimit, setStoppedByLimit] = useState(false);
  const player = useRef<AudioPlayer | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Starting is several awaits long. A start that was cancelled (Type instead, a second tap,
  // leaving the item) while it waited must not leave the microphone on or a limit timer armed.
  const generation = useRef(0);
  const busy = useRef(false);
  /** True between record() and stop(): the native flag can lag behind a just-started take. */
  const live = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const stop = useCallback(
    async (byLimit = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      try {
        live.current = false;
        await recorder.stop();
        const u = recorder.uri;
        if (u) {
          takes.add(u);
          setUri(u);
        }
        setDurationMs(recorder.getStatus().durationMillis);
        setPhase('done');
        setStoppedByLimit(byLimit);
      } catch (e) {
        log.warn('recorder.stop_failed', e);
        setPhase('idle');
      }
    },
    [recorder],
  );

  const start = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const mine = ++generation.current;
    const cancelled = () => generation.current !== mine || !mounted.current;
    setPhase('starting');
    try {
      await stopAudio();
      const perm = await requestRecordingPermissionsAsync();
      if (cancelled()) return;
      if (!perm.granted) {
        setPhase('denied');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (cancelled()) return;
      await recorder.prepareToRecordAsync();
      if (cancelled()) return;
      recorder.record();
      live.current = true;
      setPhase('recording');
      // docs/09 §6: speaking stops at its limit and submits what exists.
      if (timer.current) clearTimeout(timer.current);
      if (maxSeconds) timer.current = setTimeout(() => void stop(true), maxSeconds * 1000);
    } catch (e) {
      log.warn('recorder.start_failed', e);
      if (!cancelled()) setPhase('unsupported');
    } finally {
      busy.current = false;
      if (cancelled() && mounted.current) setPhase((p) => (p === 'starting' ? 'idle' : p));
    }
  }, [recorder, maxSeconds, stop]);

  /** Abandons a start in progress or a recording, and deletes anything it captured. */
  const cancel = useCallback(async () => {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (live.current || recorder.isRecording) {
      live.current = false;
      try {
        await recorder.stop();
        if (recorder.uri) deleteTake(recorder.uri);
      } catch (e) {
        log.warn('recorder.cancel_failed', e);
      }
    }
    if (mounted.current) setPhase('idle');
  }, [recorder]);

  const playBack = useCallback(async () => {
    if (!uri) return;
    await stopAudio();
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      player.current?.remove();
      const p = createAudioPlayer(uri);
      player.current = p;
      p.play();
    } catch (e) {
      log.warn('recorder.playback_failed', e);
    }
  }, [uri]);

  const retake = useCallback(async () => {
    player.current?.remove();
    player.current = null;
    setUri(null);
    setDurationMs(0);
    setStoppedByLimit(false);
    await start();
  }, [start]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      player.current?.remove();
      // Leaving mid-recording: stop, and delete what was captured — the lesson's own clean-up may
      // already have run, so this take would otherwise stay on the device.
      if (recorder.isRecording) {
        void recorder
          .stop()
          .then(() => {
            if (recorder.uri) deleteTake(recorder.uri);
          })
          .catch(() => undefined);
      }
    },
    [recorder],
  );

  return {
    phase,
    uri,
    durationMs: phase === 'recording' ? status.durationMillis : durationMs,
    stoppedByLimit,
    start,
    cancel,
    stop: () => stop(false),
    retake,
    playBack,
  };
}
