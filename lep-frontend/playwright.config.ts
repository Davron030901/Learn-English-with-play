import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests of the exported web build against a running lep-backend (brief §16).
 *
 *   1. start the backend (its README) — the suite registers a few accounts, so for repeated local
 *      runs raise LEP_RATE_LIMIT_REGISTER_IP_PER_HOUR;
 *   2. `npm run export:web` (EXPO_PUBLIC_API_URL must point at that backend; default 127.0.0.1:8000);
 *   3. `npm run e2e` — serves dist/ on :8081, an origin the backend's CORS allows by default.
 *
 * E2E_API_URL      the backend for direct API setup calls (default http://127.0.0.1:8000)
 * E2E_MAIL_DIR     the backend's file outbox (LEP_MAIL_OUTBOX_DIR), for the password-reset test
 * E2E_BASE_URL     use an already-running web server instead of serving dist/
 * PW_CHROMIUM      a Chromium binary to use instead of Playwright's download
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8081',
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'node scripts/serve-web.mjs dist', url: 'http://localhost:8081', reuseExistingServer: true, timeout: 30_000 },
});
