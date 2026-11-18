import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  API,
  assertBackendUp,
  overflowsX,
  registerViaApi,
  signIn,
  tid,
  uniqueEmail,
} from './helpers';

/**
 * The account on the web (frontend DECISIONS §22) and the test locales (§8 A14), against the real
 * lep-backend. The cookie and the reset tests need the backend started with
 * LEP_WEB_REFRESH_COOKIE=true and LEP_MAIL_BACKEND=file; they skip themselves otherwise.
 *
 * E2E_MAIL_DIR   the folder the backend writes its letters to (LEP_MAIL_OUTBOX_DIR)
 */

const MAIL = process.env.E2E_MAIL_DIR;
const SHOTS = join(__dirname, '.results');

test.beforeAll(async ({ request }) => {
  await assertBackendUp(request);
});

async function capabilities(page: Page): Promise<Record<string, unknown>> {
  const res = await page.request.get(`${API}/v1/capabilities`);
  return (await res.json()) as Record<string, unknown>;
}

test('a reload keeps a web learner signed in: the refresh token is an httpOnly cookie', async ({
  page,
  request,
  context,
}) => {
  test.skip(
    !(await capabilities(page)).web_refresh_cookie,
    'the backend runs without the web refresh cookie',
  );
  const email = uniqueEmail('cookie');
  await registerViaApi(request, email);
  await signIn(page, email);
  await expect(tid(page, 'path')).toBeVisible();

  const cookies = await context.cookies(API);
  const refresh = cookies.find((c) => c.name === '__Host-lep_refresh');
  expect(refresh, 'the server set the refresh cookie').toBeTruthy();
  expect(refresh?.httpOnly).toBe(true);
  expect(refresh?.sameSite).toBe('Strict');
  expect(await page.evaluate(() => document.cookie)).not.toContain('lep_refresh');
  const local = await page.evaluate(() => JSON.stringify(localStorage));
  expect(local).not.toMatch(/lep_rt_|refresh_token|access_token/);

  // a reload restores the session from the cookie instead of signing the learner out
  await page.reload();
  await expect(tid(page, 'path')).toBeVisible();
  await tid(page, 'tab-profile').click();
  await expect(tid(page, 'me-email')).toHaveText(email);

  // signing out ends it on the server and clears the cookie
  await tid(page, 'sign-out').click();
  await expect(tid(page, 'get-started')).toBeVisible();
  await expect
    .poll(async () => (await context.cookies(API)).some((c) => c.name === '__Host-lep_refresh'))
    .toBe(false);
  await page.reload();
  await expect(tid(page, 'get-started')).toBeVisible();
});

/** The text of a letter the backend wrote (its body may be base64 or quoted-printable). */
function letterText(raw: string): string {
  const [head = '', ...rest] = raw.split(/\r?\n\r?\n/);
  const body = rest.join('\n\n');
  if (/Content-Transfer-Encoding:\s*base64/i.test(head))
    return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(head)) {
    const bytes = body
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, 'latin1').toString('utf8');
  }
  return body;
}

test('a forgotten password: the same answer, the letter, a new password, signed in with it', async ({
  page,
  request,
}) => {
  test.skip(
    !MAIL || !(await capabilities(page)).password_reset,
    'set E2E_MAIL_DIR to the backend file outbox',
  );
  const mail = MAIL as string;
  const email = uniqueEmail('reset');
  await registerViaApi(request, email);
  const before = new Set(existsSync(mail) ? readdirSync(mail) : []);

  await page.goto('/forgot');
  await tid(page, 'forgot-email').fill(email);
  await tid(page, 'forgot-submit').click();
  await expect(tid(page, 'forgot-sent')).toBeVisible();
  await expect(page.getByText(`If an account uses ${email}`)).toBeVisible();

  let link = '';
  await expect
    .poll(() => {
      const fresh = (existsSync(mail) ? readdirSync(mail) : []).filter(
        (f) => f.endsWith('.eml') && !before.has(f),
      );
      for (const f of fresh) {
        const raw = readFileSync(join(mail, f), 'utf8');
        if (!raw.includes(email)) continue;
        const found = /https?:\/\/[^\s]+\/reset-password\?token=[A-Za-z0-9_-]+/.exec(
          letterText(raw),
        );
        if (found) link = found[0];
      }
      return link;
    })
    .not.toBe('');

  const next = 'a quiet morning in samarkand';
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(tid(page, 'reset-password')).toBeVisible();
  await tid(page, 'reset-new-password').fill('password1234');
  await tid(page, 'reset-submit').click();
  await expect(
    page.getByText('That password is one of the most common ones. Choose another.'),
  ).toBeVisible();
  await tid(page, 'reset-new-password').fill(next);
  await tid(page, 'reset-submit').click();
  await expect(tid(page, 'reset-done')).toBeVisible();

  // the link worked once
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await tid(page, 'reset-new-password').fill('another quiet evening walk');
  await tid(page, 'reset-submit').click();
  await expect(tid(page, 'reset-invalid')).toBeVisible();

  await signIn(page, email, next);
  await expect(tid(page, 'path')).toBeVisible();
});

const RAW_KEY =
  /\b(?:common|errors|lesson|settings|me|progress|path|unit|chat|forgot|reset|password|exam|examReport|audit|pronunciation|speak|tabs|onboarding|welcome|practice|garden|review)\.[a-zA-Z_]{2,}\b/;

for (const language of ['pseudo', 'pseudo-rtl'] as const) {
  test(`the ${language} locale: every string translated, ${language === 'pseudo-rtl' ? 'mirrored, ' : ''}nothing scrolls sideways at 360 px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.addInitScript((lng) => {
      const stored = JSON.parse(
        localStorage.getItem('lep:prefs') ?? '{"state":{},"version":1}',
      ) as { state: Record<string, unknown>; version: number };
      stored.state = {
        ...stored.state,
        interfaceLanguage: lng,
        languageChosen: true,
        showTestLanguages: true,
      };
      localStorage.setItem('lep:prefs', JSON.stringify(stored));
    }, language);
    const email = uniqueEmail(language);
    await registerViaApi(request, email);
    await signIn(page, email);
    await expect(tid(page, 'path')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe(
      language === 'pseudo-rtl' ? 'rtl' : 'ltr',
    );
    if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
    for (const tab of ['index', 'practice', 'library', 'progress', 'profile'] as const) {
      if (tab !== 'index') await tid(page, `tab-${tab}`).click();
      await expect(tid(page, tab === 'index' ? 'path' : tab)).toBeVisible();
      expect(await overflowsX(page), `${language} ${tab}`).toBe(false);
      const text = await page.evaluate(() => document.body.innerText);
      expect(
        text.match(RAW_KEY)?.[0] ?? null,
        `${language} ${tab}: an untranslated key`,
      ).toBeNull();
      // an ICU placeholder that reached the screen unformatted ({date}, or {etad} mirrored)
      expect(
        text.match(/\{\w+[,}]/)?.[0] ?? null,
        `${language} ${tab}: a raw placeholder`,
      ).toBeNull();
      // for a person to review (DECISIONS §8 A14)
      await page.screenshot({ path: join(SHOTS, `a14-${language}-${tab}.png`), fullPage: true });
    }
  });
}
