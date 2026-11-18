import AsyncStorage from '@react-native-async-storage/async-storage';

import type { KeyValueStore } from '@/outbox/outbox';

/**
 * Device storage for non-secret data: preferences, progress marks made on this device, saved
 * words and the outbox. Never tokens (those live in tokenStorage — Keychain/Keystore or memory),
 * never the birth year, never `is_minor`.
 */
export const deviceStore: KeyValueStore = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
  keysWithPrefix: async (prefix) => (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix)),
  multiGet: async (keys) => {
    if (keys.length === 0) return [];
    const byKey = new Map(await AsyncStorage.multiGet([...keys]));
    return keys.map((k) => byKey.get(k) ?? null);
  },
};

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): Promise<void> {
  return AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function removeKeysWithPrefix(prefix: string): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const mine = keys.filter((k) => k.startsWith(prefix));
  if (mine.length) await AsyncStorage.multiRemove(mine);
}
