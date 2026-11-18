import { expect, test } from '@playwright/test';

import {
  answerCurrent,
  assertBackendUp,
  registerViaApi,
  signIn,
  tid,
  uniqueEmail,
  visible,
} from './helpers';

/**
 * The performance budget (brief §15; DECISIONS §28), measured in the browser on a throttled
 * profile: the CPU slowed four times, as for a mid-range phone. The bundle's own size is checked
 * by `npm run check:budget` after the export.
 *
 *   cold start to the path   < 2.5 s  — a returning learner opening the app (the hashed bundle
 *                                       and the course are cached, as on a second visit)
 *   exercise render          < 100 ms — from "Continue" to the next exercise on screen
 */

const CPU_SLOWDOWN = Number(process.env.E2E_CPU_SLOWDOWN ?? 4);
const COLD_START_MS = 2_500;
const RENDER_MS = 100;

test.beforeAll(async ({ request }) => {
  await assertBackendUp(request);
});

test('cold start to the path, and an exercise render, within budget on a throttled CPU', async ({
  page,
  request,
  context,
}) => {
  // opt-in (E2E_PERF=1): a budget is only meaningful on the hardware it is meant for (§28)
  test.skip(process.env.E2E_PERF !== '1', 'set E2E_PERF=1 to measure the performance budget');
  const email = uniqueEmail('perf');
  await registerViaApi(request, email);
  await signIn(page, email);
  await expect(tid(page, 'path')).toBeVisible();

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });

  // cold start: the app opened again, from nothing in memory
  const started = Date.now();
  await page.reload();
  await expect(tid(page, 'path')).toBeVisible({ timeout: 30_000 });
  const coldStart = Date.now() - started;

  // an exercise render: measured in the page, from the tap to the next exercise in the DOM
  await tid(page, 'node-S01U01N2').click();
  await tid(page, 'start-S01U01N2-t1').click();
  await expect(tid(page, 'lesson')).toBeVisible();
  const renders: number[] = [];
  for (let i = 0; i < 40 && renders.length < 3; i += 1) {
    if (await visible(page, 'got-it')) {
      await tid(page, 'got-it').click();
      continue;
    }
    const ex = page.locator('[data-testid^="exercise-"]').filter({ visible: true }).first();
    if (!(await ex.count())) {
      await page.waitForTimeout(200);
      continue;
    }
    await answerCurrent(
      page,
      ((await ex.getAttribute('data-testid')) ?? '').replace('exercise-', ''),
    );
    await expect(tid(page, 'feedback-continue')).toBeVisible();
    const before = await page.evaluate(
      () => document.querySelector('[data-testid^="exercise-"]')?.getAttribute('data-testid') ?? '',
    );
    const ms = await page.evaluate(
      (prev) =>
        new Promise<number>((resolve) => {
          const button = [
            ...document.querySelectorAll<HTMLElement>('[data-testid="feedback-continue"]'),
          ].find((b) => b.offsetParent !== null);
          if (!button) return resolve(-1);
          const t0 = performance.now();
          const seen = () => {
            const ex = [
              ...document.querySelectorAll<HTMLElement>(
                '[data-testid^="exercise-"], [data-testid="present-card"], [data-testid="close"]',
              ),
            ].find((e) => e.offsetParent !== null);
            return (
              ex && (ex.getAttribute('data-testid') !== prev || ex.dataset.renderedAt === undefined)
            );
          };
          const observer = new MutationObserver(() => {
            if (seen()) {
              observer.disconnect();
              requestAnimationFrame(() => resolve(performance.now() - t0));
            }
          });
          observer.observe(document.body, { subtree: true, childList: true, attributes: true });
          button.click();
          setTimeout(() => {
            observer.disconnect();
            resolve(performance.now() - t0);
          }, 5_000);
        }),
      before,
    );
    if (ms >= 0) renders.push(Math.round(ms));
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const median = [...renders].sort((a, b) => a - b)[Math.floor(renders.length / 2)] ?? -1;
  test
    .info()
    .annotations.push(
      { type: 'cold start (ms, CPU ×4)', description: String(coldStart) },
      { type: 'exercise render (ms, CPU ×4)', description: renders.join(', ') },
    );
  console.log(
    `cold start ${coldStart} ms; exercise renders ${renders.join(', ')} ms (CPU ×${CPU_SLOWDOWN})`,
  );
  expect(renders.length).toBeGreaterThan(0);
  expect(coldStart).toBeLessThan(COLD_START_MS);
  expect(median).toBeLessThan(RENDER_MS);
});
