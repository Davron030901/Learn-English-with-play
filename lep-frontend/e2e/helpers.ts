import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

export const API = (process.env.E2E_API_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
export const PASSWORD = 'correct horse battery staple';

/** The visible element with a testID (React Navigation keeps earlier screens mounted, hidden). */
export const tid = (page: Page, id: string): Locator =>
  page.getByTestId(id).filter({ visible: true });
export const visible = async (page: Page, id: string) => (await tid(page, id).count()) > 0;

export function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Creates an account straight through the API (setup for tests that start signed out). */
export async function registerViaApi(request: APIRequestContext, email: string): Promise<void> {
  const res = await request.post(`${API}/v1/auth/register`, {
    data: {
      email,
      password: PASSWORD,
      l1: 'uz',
      birth_year: 1995,
      tz: 'Asia/Tashkent',
      daily_goal_min: 10,
      spelling_variant: 'us',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

export async function assertBackendUp(request: APIRequestContext): Promise<void> {
  const res = await request.get(`${API}/ready`).catch(() => null);
  expect(res?.ok(), `lep-backend is not answering at ${API} — start it first (see README)`).toBe(
    true,
  );
}

/** Onboarding steps 0–7 and account creation, as a new learner does them. */
export async function onboard(page: Page, email: string, birthYear = '1995'): Promise<void> {
  await page.goto('/');
  await tid(page, 'get-started').click();
  await tid(page, 'birth-year').fill(birthYear);
  await tid(page, 'onboarding-continue').click();
  await tid(page, 'why-work').click();
  await tid(page, 'onboarding-continue').click();
  await tid(page, 'l1-uz').click();
  await tid(page, 'spelling-us').click();
  await tid(page, 'onboarding-continue').click();
  // A beginner goes straight to the daily-time step; placement is only offered to the others.
  await tid(page, 'level-none').click();
  await tid(page, 'onboarding-continue').click();
  await tid(page, 'goal-10').click();
  await tid(page, 'onboarding-continue').click();
  await tid(page, 'onboarding-plan').waitFor();
  await tid(page, 'onboarding-continue').click();
  await expect(tid(page, 'honest-quote')).toBeVisible();
  await tid(page, 'onboarding-continue').click();
  await tid(page, 'register-email').fill(email);
  await tid(page, 'register-password').fill(PASSWORD);
  await tid(page, 'register-submit').click();
}

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/');
  await tid(page, 'have-account').click();
  await tid(page, 'email').fill(email);
  await tid(page, 'password').fill(password);
  await tid(page, 'sign-in-submit').click();
}

/**
 * Plays whatever lesson is on screen to CLOSE, answering each exercise with the first sensible
 * input (verdicts do not matter here; the grader has its own tests). Returns the exercise types.
 */
export async function playLesson(page: Page): Promise<string[]> {
  const seen: string[] = [];
  for (let step = 0; step < 200; step += 1) {
    if (await visible(page, 'close')) return seen;
    if (await visible(page, 'feedback-continue')) {
      await tid(page, 'feedback-continue').click();
      continue;
    }
    if (await visible(page, 'got-it')) {
      await tid(page, 'got-it').click();
      continue;
    }
    if (await visible(page, 'break')) {
      await page.getByText("I'm ready").click();
      continue;
    }
    const ex = page.locator('[data-testid^="exercise-"]').filter({ visible: true }).first();
    if (!(await ex.count())) {
      await page.waitForTimeout(200);
      continue;
    }
    const type = ((await ex.getAttribute('data-testid')) ?? '').replace('exercise-', '');
    seen.push(type);
    await answerCurrent(page, type);
  }
  throw new Error('the lesson never reached CLOSE');
}

/** True when the document is wider than the viewport (a horizontal scroll at phone width). */
export async function overflowsX(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

/** How many answers the server holds for an account (its own data export, signed in by the API). */
export async function serverAnswers(
  request: APIRequestContext,
  email: string,
  password = PASSWORD,
): Promise<number> {
  const login = await request.post(`${API}/v1/auth/login`, {
    form: { grant_type: 'password', username: email, password },
  });
  expect(login.status(), await login.text()).toBe(200);
  const { access_token } = (await login.json()) as { access_token: string };
  const res = await request.get(`${API}/v1/me/export`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  expect(res.status()).toBe(200);
  const data = (await res.json()) as { review_attempts?: unknown[] };
  return data.review_attempts?.length ?? 0;
}

/** Answers the exercise on screen once with the first sensible input (its verdict does not matter). */
export async function answerCurrent(page: Page, type: string): Promise<void> {
  if (await visible(page, 'option-0')) {
    await tid(page, 'option-0').click();
    await tid(page, 'check').click();
  } else if (await visible(page, 'answer-input')) {
    await tid(page, 'answer-input').fill('answer');
    await tid(page, 'check').click();
  } else if (await visible(page, 'bank-tiles')) {
    await page.locator('[data-testid^="tile-"]').filter({ visible: true }).first().click();
    await tid(page, 'check').click();
  } else if (await visible(page, 'order-list')) {
    await tid(page, 'check').click();
  } else if (await visible(page, 'type-instead')) {
    await tid(page, 'type-instead').click();
    await tid(page, 'speak-typed').fill('Hello');
    await tid(page, 'check').click();
  } else if (await visible(page, 'bin-row-0')) {
    const rows = await page.locator('[data-testid^="bin-row-"]').filter({ visible: true }).count();
    for (let i = 0; i < rows; i += 1)
      await tid(page, `bin-row-${i}`).getByRole('radio').first().click();
    await tid(page, 'check').click();
  } else if (await visible(page, 'left-0')) {
    const n = await page.locator('[data-testid^="left-"]').filter({ visible: true }).count();
    for (let l = 0; l < n && !(await visible(page, 'feedback-continue')); l += 1) {
      for (let r = 0; r < n; r += 1) {
        if (await visible(page, 'feedback-continue')) break;
        if ((await tid(page, `left-${l}`).getAttribute('aria-disabled')) === 'true') break;
        if ((await tid(page, `right-${r}`).getAttribute('aria-disabled')) === 'true') continue;
        await tid(page, `left-${l}`).click();
        await tid(page, `right-${r}`).click();
      }
    }
  } else {
    throw new Error(`no driver for ${type}`);
  }
}
