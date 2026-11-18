import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { log } from '@/lib/log';
import { usePrefs } from '@/state/prefs';

import { currentlyPlaying, subscribe as subscribeSpeech } from './speech';

/**
 * Sound effects and haptics — the game's feedback layer, kept separate from the speech channel
 * (`speech.ts`) so a chime never cuts off the voice and the voice never waits for a chime.
 *
 * The sounds are synthesised by `scripts/gen-sounds.mjs` (no samples, no licences): soft bells,
 * a dutar pluck and a doira stroke. They are short by design — feedback must not delay the next
 * item (docs/10 §10) — and a wrong answer sounds soft and low, never like a buzzer (docs/10 §8.3).
 *
 * Mixing rules (docs/16 E07):
 *   * at most two effects in any 500 ms;
 *   * a celebration never plays over speech: it waits up to 1.5 s for the voice to finish and is
 *     skipped otherwise;
 *   * "calm" celebrations swap the biggest fanfare for the lesson-complete chime;
 *   * everything is off with "practise without audio" or "sound effects" switched off; haptics are
 *     their own preference and never fire on the web.
 */
export type Sfx =
  | 'correct'
  | 'incorrect'
  | 'tap'
  | 'pop'
  | 'combo'
  | 'complete'
  | 'streak'
  | 'levelup'
  | 'gem'
  | 'unlock'
  | 'water'
  | 'bloom'
  | 'quest'
  | 'ring'
  | 'stamp'
  | 'chapter'
  | 'freeze'
  | 'page'
  | 'kudos'
  | 'promote'
  | 'mic_on'
  | 'mic_off'
  | 'hint'
  | 'whoosh';

const SOURCES: Record<Sfx, number> = {
  correct: require('../../assets/sfx/correct.wav'),
  incorrect: require('../../assets/sfx/incorrect.wav'),
  tap: require('../../assets/sfx/tap.wav'),
  pop: require('../../assets/sfx/pop.wav'),
  combo: require('../../assets/sfx/combo.wav'),
  complete: require('../../assets/sfx/complete.wav'),
  streak: require('../../assets/sfx/streak.wav'),
  levelup: require('../../assets/sfx/levelup.wav'),
  gem: require('../../assets/sfx/gem.wav'),
  unlock: require('../../assets/sfx/unlock.wav'),
  water: require('../../assets/sfx/water.wav'),
  bloom: require('../../assets/sfx/bloom.wav'),
  quest: require('../../assets/sfx/quest.wav'),
  ring: require('../../assets/sfx/ring.wav'),
  stamp: require('../../assets/sfx/stamp.wav'),
  chapter: require('../../assets/sfx/chapter.wav'),
  freeze: require('../../assets/sfx/freeze.wav'),
  page: require('../../assets/sfx/page.wav'),
  kudos: require('../../assets/sfx/kudos.wav'),
  promote: require('../../assets/sfx/promote.wav'),
  mic_on: require('../../assets/sfx/mic_on.wav'),
  mic_off: require('../../assets/sfx/mic_off.wav'),
  hint: require('../../assets/sfx/hint.wav'),
  whoosh: require('../../assets/sfx/whoosh.wav'),
};

const VOLUME: Partial<Record<Sfx, number>> = { tap: 0.5, pop: 0.5, page: 0.3, mic_on: 0.4, mic_off: 0.4 };
const DEFAULT_VOLUME = 0.8;

/** Celebrations wait for speech to finish; answer and interface sounds never wait. */
const CELEBRATORY: ReadonlySet<Sfx> = new Set(['complete', 'streak', 'levelup', 'gem', 'unlock', 'bloom', 'quest', 'ring', 'stamp', 'chapter', 'promote']);

/** The haptic that accompanies each sound, where one fits (page, hint and whoosh have none). */
const HAPTIC: Partial<Record<Sfx, () => Promise<void>>> = {
  correct: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  incorrect: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  tap: () => Haptics.selectionAsync(),
  pop: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  combo: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  complete: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  streak: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  levelup: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  unlock: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  bloom: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  quest: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  stamp: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  ring: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  freeze: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  chapter: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  kudos: () => Haptics.selectionAsync(),
  promote: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  mic_on: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
};

const WINDOW_MS = 500;
const MAX_IN_WINDOW = 2;
const SPEECH_WAIT_MS = 1500;

const players = new Map<Sfx, AudioPlayer>();
let recent: number[] = [];

function playerFor(name: Sfx): AudioPlayer {
  let p = players.get(name);
  if (!p) {
    p = createAudioPlayer(SOURCES[name]);
    p.volume = VOLUME[name] ?? DEFAULT_VOLUME;
    players.set(name, p);
  }
  return p;
}

function enabled(): { sound: boolean; haptics: boolean } {
  const s = usePrefs.getState();
  return { sound: s.soundEffects && !s.noAudio, haptics: s.haptics && Platform.OS !== 'web' };
}

/** Loads the players for the sounds a screen is about to use, so the first one is instant. */
export function preloadSfx(names: readonly Sfx[]): void {
  if (!enabled().sound) return;
  for (const n of names) {
    try {
      playerFor(n);
    } catch (e) {
      log.warn('sfx.preload_failed', { name: n, error: String(e) });
    }
  }
}

function admit(now: number): boolean {
  recent = recent.filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_IN_WINDOW) return false;
  recent.push(now);
  return true;
}

function fire(name: Sfx, on: { sound: boolean; haptics: boolean }): void {
  if (!admit(Date.now())) return;
  if (on.sound) {
    try {
      const p = playerFor(name);
      void p.seekTo(0).then(() => p.play());
    } catch (e) {
      log.warn('sfx.play_failed', { name, error: String(e) });
    }
  }
  const h = HAPTIC[name];
  if (on.haptics && h) void h().catch(() => undefined);
}

/** Plays a sound effect (and its haptic). Never throws, never blocks the caller. */
export function sfx(requested: Sfx): void {
  const on = enabled();
  if (!on.sound && !on.haptics) return;
  // Calm celebrations: the biggest fanfare becomes the gentle lesson-complete chime.
  const name: Sfx = requested === 'levelup' && usePrefs.getState().celebrations === 'calm' ? 'complete' : requested;
  if (!CELEBRATORY.has(name) || currentlyPlaying() === null) {
    fire(name, on);
    return;
  }
  // A celebration never plays over the voice: wait for it to finish, or let the moment pass.
  const started = Date.now();
  const unsubscribe = subscribeSpeech(() => {
    if (currentlyPlaying() !== null) return;
    unsubscribe();
    clearTimeout(giveUp);
    if (Date.now() - started <= SPEECH_WAIT_MS) fire(name, enabled());
  });
  const giveUp = setTimeout(() => unsubscribe(), SPEECH_WAIT_MS);
}

/** Releases every player (used when the learner turns sound effects off). */
export function releaseSfx(): void {
  for (const p of players.values()) p.remove();
  players.clear();
}
