import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { useSyncExternalStore } from 'react';

import { log } from '@/lib/log';
import { countEvent } from '@/state/clientEvents';

import type { AudioSource } from './resolve';

/**
 * One audio channel for the whole app: starting something stops whatever was playing.
 *
 * Speed (docs/06 §1.1, brief §7.2): 1.0× and 0.75× everywhere, 0.5× at A1–A2, pitch preserved.
 *   * synthetic voice — the synthesiser *speaks* slower (its rate parameter), so there is no
 *     pitch shift to correct on iOS, Android or the web's SpeechSynthesis;
 *   * recorded assets — expo-audio's setPlaybackRate with high-quality pitch correction
 *     (AVAudioTimePitch on iOS, Sonic time-stretch on Android, `preservesPitch` on the web).
 */
export type Accent = 'us' | 'uk';

interface ChannelState {
  playingKey: string | null;
}

let state: ChannelState = { playingKey: null };
const listeners = new Set<() => void>();
let player: AudioPlayer | null = null;

function setState(next: ChannelState) {
  state = next;
  for (const l of listeners) l();
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** What is speaking right now (a button's key), or null — for non-React callers such as sfx. */
export function currentlyPlaying(): string | null {
  return state.playingKey;
}

export function usePlayingKey(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => state.playingKey,
    () => null,
  );
}

/**
 * Sources that were meant to be recordings but played in the synthetic voice because the file did
 * not load. The "Synthetic voice" marker follows what was actually heard, not what was planned.
 */
const fellBack = new Set<string>();

function markFallback(key: string) {
  const base = key.split('@')[0] ?? key;
  if (fellBack.has(base)) return;
  fellBack.add(base);
  for (const l of listeners) l();
}

/** True once the source behind `audioKey` has played in the synthetic voice instead of a recording. */
export function useSyntheticFallback(audioKey: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => fellBack.has(audioKey),
    () => false,
  );
}

/** As useSyntheticFallback, for a set of sources (one marker for a row of option buttons). */
export function useAnySyntheticFallback(audioKeys: readonly string[]): boolean {
  const joined = audioKeys.join('\n');
  return useSyncExternalStore(
    subscribe,
    () => joined !== '' && joined.split('\n').some((k) => fellBack.has(k)),
    () => false,
  );
}

export async function stopAudio(): Promise<void> {
  try {
    await Speech.stop();
  } catch {
    // nothing was speaking
  }
  if (player) {
    try {
      player.pause();
      player.remove();
    } catch {
      // already released
    }
    player = null;
  }
  if (state.playingKey) setState({ playingKey: null });
}

let englishVoice: Promise<boolean> | null = null;

/** Whether the device has any English synthesiser voice (web browsers may have none). */
export function hasEnglishVoice(): Promise<boolean> {
  englishVoice ??= Speech.getAvailableVoicesAsync()
    .then(
      (voices) =>
        voices.length === 0 || voices.some((v) => v.language?.toLowerCase().startsWith('en')),
    )
    .catch(() => true);
  return englishVoice;
}

function speakText(key: string, text: string, rate: number, accent: Accent): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      if (state.playingKey === key) setState({ playingKey: null });
      resolve();
    };
    setState({ playingKey: key });
    Speech.speak(text, {
      language: accent === 'uk' ? 'en-GB' : 'en-US',
      rate,
      onDone: done,
      onStopped: done,
      onError: (e) => {
        log.warn('audio.tts_error', { message: e.message });
        done();
      },
    });
  });
}

/**
 * Plays a resolved source. `key` identifies the button that asked (its "playing" state).
 * Resolves when playback ends or is stopped.
 */
export async function play(
  key: string,
  source: AudioSource,
  opts: { rate: number; accent: Accent },
): Promise<void> {
  await stopAudio();
  if (source.kind === 'unavailable') return;
  if (source.kind === 'tts') return speakText(key, source.text, opts.rate, opts.accent);
  try {
    const p = createAudioPlayer(source.url);
    player = p;
    p.setPlaybackRate(opts.rate, 'high');
    setState({ playingKey: key });
    await new Promise<void>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const sub = p.addListener('playbackStatusUpdate', (s) => {
        if (s.didJustFinish) {
          sub.remove();
          if (timeout) clearTimeout(timeout);
          resolve();
        }
      });
      p.play();
      timeout = setTimeout(() => {
        sub.remove();
        // Superseded by another play or a stop: nothing to fall back from.
        if (player !== p) resolve();
        else if (!p.isLoaded) reject(new Error('asset did not load'));
      }, 4000);
    });
    if (state.playingKey === key) setState({ playingKey: null });
  } catch (e) {
    // A missing recording falls back to the synthetic voice, still marked as such by the caller —
    // but only if this call is still the current one, so a stopped clip never plays twice.
    log.info('audio.asset_fallback', { message: String(e) });
    const current = player;
    try {
      current?.pause();
      current?.remove();
    } catch {
      // the player may already be gone
    }
    if (player === current) player = null;
    if (source.fallbackText) {
      markFallback(key);
      countEvent('audio_fallback');
      return speakText(key, source.fallbackText, opts.rate, opts.accent);
    }
    if (state.playingKey === key) setState({ playingKey: null });
  }
}
