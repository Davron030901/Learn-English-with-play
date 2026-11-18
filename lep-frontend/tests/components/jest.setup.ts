/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Native modules the component tests render through, replaced by small in-memory fakes.
 * Nothing here talks to a network, a microphone or a speech engine.
 */

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock'));

jest.mock('expo-speech', () => ({
  speak: jest.fn((_text: string, opts?: { onDone?: () => void }) => opts?.onDone?.()),
  stop: jest.fn(() => Promise.resolve()),
  getAvailableVoicesAsync: jest.fn(() => Promise.resolve([{ language: 'en-US', identifier: 'en' }])),
}));

jest.mock('expo-audio', () => {
  const recorder = {
    uri: 'file:///take.m4a',
    isRecording: false,
    prepareToRecordAsync: jest.fn(() => Promise.resolve()),
    record: jest.fn(),
    stop: jest.fn(() => Promise.resolve()),
    getStatus: jest.fn(() => ({ durationMillis: 1200 })),
  };
  return {
    useAudioRecorder: () => recorder,
    useAudioRecorderState: () => ({ durationMillis: 0, isRecording: false }),
    createAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), remove: jest.fn(), setPlaybackRate: jest.fn(), addListener: () => ({ remove: jest.fn() }), isLoaded: true }),
    requestRecordingPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
    setAudioModeAsync: jest.fn(() => Promise.resolve()),
    IOSOutputFormat: { MPEG4AAC: 'aac' },
    AudioQuality: { HIGH: 96 },
  };
});

jest.mock('expo-secure-store', () => {
  const m = new Map<string, string>();
  return {
    getItemAsync: jest.fn((k: string) => Promise.resolve(m.get(k) ?? null)),
    setItemAsync: jest.fn((k: string, v: string) => {
      m.set(k, v);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((k: string) => {
      m.delete(k);
      return Promise.resolve();
    }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  };
});

jest.mock('expo-notifications', () => ({
  cancelAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve()),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  SchedulableTriggerInputTypes: { DAILY: 'daily', WEEKLY: 'weekly' },
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(() => Promise.resolve(true)), shareAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-file-system', () => ({
  File: class {
    uri = 'file:///cache/export.json';
    create() {}
    write() {}
    delete() {}
    text() {
      return Promise.resolve('{}');
    }
  },
  Paths: { cache: 'file:///cache' },
}));
jest.mock('expo-localization', () => ({ getCalendars: () => [{ timeZone: 'Asia/Tashkent' }], getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' } } }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: jest.fn(() => ({})),
  useIsFocused: jest.fn(() => true),
  useFocusEffect: jest.fn(),
  Link: ({ children }: { children: unknown }) => children,
  Redirect: () => null,
}));

// Reanimated 4 and its worklets runtime need native code; their own jest mocks stand in (animations
// resolve to their end values at once, which is what a reduced-motion learner sees anyway).
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
