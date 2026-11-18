/**
 * Refresh-token storage — web (and Node tests).
 *
 * DECISIONS F8, §22: expo-secure-store has no web implementation. Where the server offers it,
 * the web's refresh token is an httpOnly cookie (cookieTransport.ts) and this store stays empty;
 * against a server without the cookie flow it lives here, in memory only, and a reload means
 * signing in again. It is never written to localStorage, sessionStorage or IndexedDB (brief
 * §4.1; lint and a guardrail test enforce it). The native build uses tokenStorage.native.ts
 * (Keychain / Keystore).
 */
export interface RefreshTokenStorage {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
  /** True when the token survives an app restart. */
  readonly persistent: boolean;
}

export function createMemoryTokenStorage(): RefreshTokenStorage {
  let token: string | null = null;
  return {
    persistent: false,
    get: () => Promise.resolve(token),
    set: (t) => {
      token = t;
      return Promise.resolve();
    },
    clear: () => {
      token = null;
      return Promise.resolve();
    },
  };
}

export const tokenStorage: RefreshTokenStorage = createMemoryTokenStorage();
