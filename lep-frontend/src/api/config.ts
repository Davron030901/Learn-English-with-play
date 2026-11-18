/**
 * Where the backend lives. EXPO_PUBLIC_API_URL is inlined at build time; it is a URL, never a
 * key (the guardrail test fails the build on any EXPO_PUBLIC_*KEY* / *SECRET* variable).
 *
 * Web dev server (localhost:8081) and the e2e build (localhost:4173) talk to a local backend on
 * 127.0.0.1:8000 by default. A phone on the same Wi-Fi needs the computer's LAN address, e.g.
 * EXPO_PUBLIC_API_URL=http://192.168.1.20:8000 — see README.
 */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8000').replace(
  /\/+$/,
  '',
);
