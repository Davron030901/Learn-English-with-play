import { readJson, writeJson } from '@/state/storage';

import type { CookieTransport } from './session';

/**
 * The web's refresh cookie (DECISIONS F8, §22). The server sets the refresh token as an
 * httpOnly `__Host-` cookie when the app asks for it, so script never holds it. All the device
 * keeps is a flag — "a cookie session is expected" — so a reload restores the session with one
 * refresh instead of signing the learner out. Native builds use cookieTransport.native.ts (none:
 * the keystore holds their token).
 */

/** Device-level, not under `lep:learner:` — it says whether there is a learner at all. */
const HINT_KEY = 'lep:device:cookie-session';

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

function locks(): LockManagerLike | undefined {
  const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
  return nav?.locks;
}

export const cookieTransport: CookieTransport | undefined = {
  expected: () => readJson<boolean>(HINT_KEY, false),
  remember: (expected) => {
    void writeJson(HINT_KEY, expected).catch(() => {
      // a lost flag costs one sign-in after a reload, nothing more
    });
  },
  // Web Locks: one refresh at a time across every tab; where the API is missing, tabs are
  // left to the server's reuse rule (a collision signs the learner out, never in elsewhere)
  exclusive: (work) => {
    const manager = locks();
    return manager ? manager.request('lep-refresh', work) : work();
  },
};
