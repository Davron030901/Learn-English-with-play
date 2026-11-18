import * as SecureStore from 'expo-secure-store';

import type { RefreshTokenStorage } from './tokenStorage';

export type { RefreshTokenStorage } from './tokenStorage';
export { createMemoryTokenStorage } from './tokenStorage';

/**
 * Refresh-token storage — iOS and Android (DECISIONS §7.1).
 * Keychain / Keystore with AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: the token survives restarts,
 * is readable by a background refresh after the first unlock, and is excluded from backups and
 * device-to-device transfer. Never AsyncStorage.
 */
const KEY = 'lep.refresh_token';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const tokenStorage: RefreshTokenStorage = {
  persistent: true,
  get: () => SecureStore.getItemAsync(KEY, OPTIONS),
  set: (t) => SecureStore.setItemAsync(KEY, t, OPTIONS),
  clear: () => SecureStore.deleteItemAsync(KEY, OPTIONS),
};
