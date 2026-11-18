import { expect, test } from '@playwright/test';

import { assertBackendUp, playLesson, registerViaApi, signIn, tid, uniqueEmail } from './helpers';

/**
 * Opt-in weekly leagues (docs/16 E23) in a real browser against the real server: off by default,
 * joined from Me with a display name, and the learner's first lesson of the week puts them in a
 * group they can see — with their name, their XP and nobody's email.
 */

test.beforeAll(async ({ request }) => {
  await assertBackendUp(request);
});

test('join leagues from Me, play a lesson, and find yourself in this week’s group', async ({
  page,
  request,
}) => {
  const email = uniqueEmail('league');
  await registerViaApi(request, email);
  await signIn(page, email);
  await expect(tid(page, 'path')).toBeVisible();

  await tid(page, 'tab-profile').click();
  await expect(tid(page, 'profile-leagues')).toContainText('Off. Join if you like.');
  await tid(page, 'profile-leagues').click();
  await expect(tid(page, 'leagues-explainer')).toContainText('some find it stressful');

  // the name is checked before it is sent, then the server keeps it
  await tid(page, 'leagues-name').fill('me@example.com');
  await tid(page, 'leagues-join').click();
  await expect(page.getByText(/Use letters, digits, spaces, _ or - only/)).toBeVisible();
  await tid(page, 'leagues-name').fill('Aziz E2E');
  await tid(page, 'leagues-join').click();
  await expect(tid(page, 'leagues-no-group')).toBeVisible();
  await expect(tid(page, 'leagues-tier')).toHaveText('Clay League');
  await expect(tid(page, 'leagues-week-ends')).toContainText(/^Week ends /);

  // the week's first lesson: the answers reach the server, and the learner is in a group
  await page.goBack();
  await tid(page, 'tab-index').click();
  await tid(page, 'node-S01U01N2').click();
  await tid(page, 'start-S01U01N2-t1').click();
  await playLesson(page);
  await tid(page, 'close-stop').click();
  await expect(tid(page, 'path')).toBeVisible();
  await tid(page, 'tab-profile').click();
  await tid(page, 'settings-privacy').click();
  await expect(tid(page, 'pending-count')).toHaveText('No answers waiting to be sent.');
  await page.goBack();

  await tid(page, 'profile-leagues').click();
  await expect(tid(page, 'leagues-table')).toBeVisible();
  const me = page.getByLabel(/^Place \d+: Aziz E2E \(You\), \d+ XP/);
  await expect(me).toBeVisible();
  await expect(tid(page, 'leagues-table')).not.toContainText('@');
  await page.screenshot({ path: 'e2e/.results/leagues-table.png', fullPage: true });

  // leaving is one tap and a neutral confirmation
  await tid(page, 'leagues-leave').click();
  await expect(page.getByText('Your tier is kept for 4 weeks.')).toBeVisible();
  await tid(page, 'leagues-leave-yes').click();
  await expect(tid(page, 'leagues-explainer')).toBeVisible();
});
