import { expect, test } from '@playwright/test';

import {
  API,
  assertBackendUp,
  onboard,
  overflowsX,
  PASSWORD,
  playLesson,
  registerViaApi,
  serverAnswers,
  signIn,
  tid,
  uniqueEmail,
} from './helpers';

/**
 * The web build against the real lep-backend: Phase 1 acceptance (register, sign in, /v1/me,
 * errors by type, the session rules) and the learning loop on top of it (brief §16).
 */

test.beforeAll(async ({ request }) => {
  await assertBackendUp(request);
});

test('a new learner: onboarding → account → first sentence → path, with /v1/me behind it', async ({
  page,
}) => {
  const email = uniqueEmail('new');
  const registers: number[] = [];
  page.on('response', (r) => {
    if (r.url().endsWith('/v1/auth/register')) registers.push(r.status());
  });
  await onboard(page, email);
  await expect(tid(page, 'first-sentence')).toBeVisible();
  expect(registers).toEqual([201]);

  // Step 8 — the text route.
  await tid(page, 'type-instead').click();
  await tid(page, 'speak-typed').fill('Hello! My name is Aziz.');
  await tid(page, 'check').click();
  await expect(tid(page, 'first-sentence-done')).toBeVisible();
  await tid(page, 'first-sentence-path').click();
  await expect(tid(page, 'path')).toBeVisible();

  // The Me tab shows what GET /v1/me returned.
  await tid(page, 'tab-profile').click();
  await expect(tid(page, 'me-email')).toHaveText(email);

  // The refresh token never reaches web storage (brief §4.1).
  const stored = await page.evaluate(async () => {
    const dump = (s: Storage) =>
      Object.keys(s)
        .map((k) => `${k}=${s.getItem(k) ?? ''}`)
        .join('\n');
    const dbs =
      'databases' in indexedDB ? (await indexedDB.databases()).map((d) => d.name ?? '') : [];
    return {
      local: dump(localStorage),
      session: dump(sessionStorage),
      dbs,
      cookies: document.cookie,
    };
  });
  for (const v of [stored.local, stored.session, stored.cookies, stored.dbs.join(',')]) {
    expect(v).not.toMatch(/lep_rt_|eyJ[A-Za-z0-9_-]+\.|refresh_token|access_token/);
  }
});

test('under 13: a kind stop before any account request, and the year is not kept', async ({
  page,
}) => {
  let registerCalls = 0;
  page.on('request', (r) => {
    if (r.url().includes('/v1/auth/register')) registerCalls += 1;
  });
  await page.goto('/');
  await tid(page, 'get-started').click();
  await tid(page, 'birth-year').fill(String(new Date().getFullYear() - 10));
  await tid(page, 'onboarding-continue').click();
  await expect(tid(page, 'not-yet')).toBeVisible();
  expect(registerCalls).toBe(0);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain(String(new Date().getFullYear() - 10));
});

test('sign in: success, wrong password, and a 503 that is never called a wrong password', async ({
  page,
  request,
}) => {
  const email = uniqueEmail('signin');
  await registerViaApi(request, email);

  await signIn(page, email, 'not the password at all');
  await expect(tid(page, 'sign-in-error')).toContainText("That email and password don't match");

  await page.route('**/v1/auth/login', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      headers: { 'x-request-id': 'req-e2e-503' },
      body: JSON.stringify({
        type: 'dependency_unavailable',
        title: 'Service Unavailable',
        status: 503,
        request_id: 'req-e2e-503',
      }),
    }),
  );
  await tid(page, 'password').fill(PASSWORD);
  await tid(page, 'sign-in-submit').click();
  await expect(tid(page, 'sign-in-error')).toContainText("We can't sign you in right now");
  await expect(tid(page, 'sign-in-error')).not.toContainText("don't match");
  await expect(tid(page, 'sign-in-error')).toContainText('req-e2e-503');
  await page.unroute('**/v1/auth/login');

  await tid(page, 'sign-in-submit').click();
  await expect(tid(page, 'path')).toBeVisible();
});

test('a lesson end to end: present, answer, feedback, CLOSE; the path and Privacy reflect it', async ({
  page,
  request,
}) => {
  const email = uniqueEmail('lesson');
  await registerViaApi(request, email);
  await signIn(page, email);
  await expect(tid(page, 'path')).toBeVisible();

  await tid(page, 'node-S01U01N2').click();
  await tid(page, 'start-S01U01N2-t1').click();
  await expect(tid(page, 'lesson')).toBeVisible();
  await expect(tid(page, 'present-grammar')).toBeVisible();
  const types = await playLesson(page);
  expect(types.length).toBeGreaterThan(5);
  await expect(tid(page, 'close-practised')).toContainText(
    `You practised ${types.length} exercises.`,
  );
  await tid(page, 'close-stop').click();

  await expect(tid(page, 'path')).toBeVisible();
  // finished on this device at once; once the server has the answers it says so itself
  await expect(
    page.getByLabel(/I am, you are\. 1 of 3 tiers finished( on this device)?\./),
  ).toBeVisible();

  // the outbox hands every answer to the server (POST /v1/sync/reviews) and empties
  await tid(page, 'tab-profile').click();
  await tid(page, 'settings-privacy').click();
  await expect(tid(page, 'pending-count')).toHaveText('No answers waiting to be sent.');
  expect(await serverAnswers(request, email)).toBe(types.length);
});

test('answers are kept while /v1/me is down: the session already knows whose they are', async ({
  page,
  request,
}) => {
  const email = uniqueEmail('medown');
  await registerViaApi(request, email);
  await page.route('**/v1/me', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({ type: 'dependency_unavailable', status: 503, request_id: 'r-503' }),
    }),
  );
  await signIn(page, email);
  await expect(tid(page, 'path')).toBeVisible();
  await tid(page, 'node-S01U01N2').click();
  await tid(page, 'start-S01U01N2-t1').click();
  const types = await playLesson(page);
  await tid(page, 'close-stop').click();
  // the answers were kept under the right learner although /v1/me never answered
  await expect.poll(() => serverAnswers(request, email)).toBe(types.length);
  await tid(page, 'tab-profile').click();
  await tid(page, 'settings-privacy').click();
  await expect(tid(page, 'pending-count')).toHaveText('No answers waiting to be sent.');
});

test('offline: the banner says so, the next lesson still opens, and nothing is lost', async ({
  page,
  context,
  request,
}) => {
  const email = uniqueEmail('offline');
  await registerViaApi(request, email);
  // The path warms the current unit while online; wait for that before the network goes.
  const warmed = page.waitForResponse((r) => /u001\.[0-9a-f]+\.lep/.test(r.url()) && r.ok());
  await signIn(page, email);
  await expect(tid(page, 'path')).toBeVisible();
  await warmed;

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(tid(page, 'offline-banner')).toBeVisible();

  await tid(page, 'continue').click();
  await expect(tid(page, 'lesson')).toBeVisible();
  await expect(tid(page, 'got-it')).toBeVisible();
  await tid(page, 'got-it').click();
  await tid(page, 'lesson-close').click();
  await tid(page, 'leave-yes').click();
  await expect(tid(page, 'path')).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(tid(page, 'offline-banner')).toHaveCount(0);
});

test('session rules: a 503 on /v1/me keeps you signed in; a revoked session signs you out', async ({
  page,
  request,
}) => {
  const email = uniqueEmail('session');
  await registerViaApi(request, email);
  await page.route('**/v1/me', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'dependency_unavailable',
        title: 'x',
        status: 503,
        request_id: 'req-me-503',
      }),
    }),
  );
  await signIn(page, email);
  await expect(tid(page, 'path')).toBeVisible();
  await tid(page, 'tab-profile').click();
  await expect(
    page.getByText('Our server is having a moment. Please try again shortly.'),
  ).toBeVisible();
  await expect(page.getByText('Reference: req-me-503')).toBeVisible();
  await expect(tid(page, 'profile')).toBeVisible();

  await page.unroute('**/v1/me');
  await page.route('**/v1/me', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/problem+json',
      body: JSON.stringify({ type: 'session_revoked', status: 401, request_id: 'req-me-401' }),
    }),
  );
  let refreshes = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/v1/auth/refresh')) refreshes += 1;
  });
  await page.getByRole('button', { name: 'Try again' }).first().click();
  await expect(tid(page, 'welcome')).toBeVisible();
  // session_revoked is a sign-out, never a refresh trigger.
  expect(refreshes).toBe(0);
});

test('360 px: no horizontal scrolling on the main screens', async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const email = uniqueEmail('narrow');
  await registerViaApi(request, email);
  await signIn(page, email);
  await expect(tid(page, 'path')).toBeVisible();
  expect(await overflowsX(page)).toBe(false);
  for (const tab of ['practice', 'library', 'progress', 'profile'] as const) {
    await tid(page, `tab-${tab}`).click();
    await expect(tid(page, tab)).toBeVisible();
    expect(await overflowsX(page), tab).toBe(false);
  }
  for (const p of ['learning', 'accessibility', 'privacy']) {
    await tid(page, `settings-${p}`).click();
    await expect(tid(page, `settings-page-${p}`)).toBeVisible();
    expect(await overflowsX(page), p).toBe(false);
    await tid(page, 'back').click();
  }
  await tid(page, 'tab-index').click();
  await tid(page, 'continue').click();
  await expect(tid(page, 'lesson')).toBeVisible();
  expect(await overflowsX(page), 'lesson').toBe(false);
  expect(API).toMatch(/^http/);
});
