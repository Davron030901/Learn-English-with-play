import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { InterfaceLanguage } from '@/i18n';

/**
 * Device preferences — the settings that belong to this device rather than the account:
 * interface language, appearance, accessibility, audio and reminders. Account settings
 * (daily goal, spelling variant, rest days, retention…) are the server's: read from GET /v1/me
 * and changed through PATCH /v1/me/settings, never stored here.
 */
export type TimerPreference = 'default' | 'double' | 'off';
export type Speed = 1 | 0.75 | 0.5;
/** The app theme's accent hue (docs/16 E17); the same union as the design system's ThemeAccent. */
export type AccentPreference = 'default' | 'lagoon' | 'orange' | 'purple';

export interface ReminderPrefs {
  enabled: boolean;
  hour: number;
  minute: number;
  cue: 'afterBreakfast' | 'commute' | 'lunch' | 'work' | 'dinner';
  /** Per day: 1 by default, 2 if the learner opts up; the hard cap is 3 (docs/10 §7). */
  perDay: 1 | 2;
  /** Reminders delivered while the app stayed closed — five in a row cuts them to weekly. */
  ignoredInARow: number;
  weekly: boolean;
  paused: boolean;
  lastScheduledAt: string | null;
  lastOpenedAt: string | null;
}

export interface Prefs {
  interfaceLanguage: InterfaceLanguage;
  theme: 'system' | 'light' | 'dark';
  dyslexiaFont: boolean;
  reduceMotion: boolean;
  timers: TimerPreference;
  timedMode: boolean;
  noAudio: boolean;
  noVision: boolean;
  speed: Speed;
  whisper: boolean;
  /** Sound effects (chimes for right answers, celebrations). Off with noAudio as well. */
  soundEffects: boolean;
  /** Haptic feedback on phones. */
  haptics: boolean;
  /** "calm": no confetti, short sequences, the gentlest fanfare (docs/16 E07). */
  celebrations: 'full' | 'calm';
  /**
   * The app theme bought in the shop. The server's equipped item is the record; this copy only
   * lets the theme apply at start-up and offline, and follows the shop whenever it loads.
   */
  accent: AccentPreference;
  showTestLanguages: boolean;
  reminders: ReminderPrefs;
  /** Set once the welcome flow has offered the interface language. */
  languageChosen: boolean;
}

export const DEFAULT_REMINDERS: ReminderPrefs = {
  enabled: false,
  hour: 19,
  minute: 0,
  cue: 'dinner',
  perDay: 1,
  ignoredInARow: 0,
  weekly: false,
  paused: false,
  lastScheduledAt: null,
  lastOpenedAt: null,
};

export const DEFAULT_PREFS: Prefs = {
  interfaceLanguage: 'en',
  theme: 'system',
  dyslexiaFont: false,
  reduceMotion: false,
  timers: 'default',
  timedMode: false,
  noAudio: false,
  noVision: false,
  speed: 1,
  whisper: false,
  soundEffects: true,
  haptics: true,
  celebrations: 'full',
  accent: 'default',
  showTestLanguages: false,
  reminders: DEFAULT_REMINDERS,
  languageChosen: false,
};

interface PrefsStore extends Prefs {
  hydrated: boolean;
  set: (patch: Partial<Prefs>) => void;
  setReminders: (patch: Partial<ReminderPrefs>) => void;
  reset: () => void;
}

export const usePrefs = create<PrefsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFS,
      hydrated: false,
      set: (patch) => set(patch),
      setReminders: (patch) => set((s) => ({ reminders: { ...s.reminders, ...patch } })),
      reset: () => set({ ...DEFAULT_PREFS }),
    }),
    {
      name: 'lep:prefs',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _h, set: _s, setReminders: _r, reset: _x, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        usePrefs.setState({ hydrated: true });
      },
    },
  ),
);
