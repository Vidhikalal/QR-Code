import { expect, test, type Browser } from '@playwright/test';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { E2E_ORIGIN } from '../fixtures/e2e';
import { createStandardFixture, type Badges, type StandardFixture } from '../fixtures/standard';

// PLAN F24 (V6): Connect on badge pages; "My connections".
test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] } });

let f: StandardFixture;
let b: Badges;
test.beforeAll(async () => {
  f = await createStandardFixture();
  b = await f.addBadges(); // A wears T1, B wears T2
  await f.checkIn(f.p.A, f.token.A);
  await f.checkIn(f.p.B, f.token.B);
  await f.pool.query(`insert into profiles (participant_id, nickname, linkedin_url) values ($1, 'Benji', 'https://www.linkedin.com/in/benji') on conflict (participant_id) do update set nickname = excluded.nickname, linkedin_url = excluded.linkedin_url`, [f.p.B]);
});
test.afterAll(async () => {
  await f.close();
});

async function signedIn(browser: Browser, participantId: string) {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const key = generateSecret();
  await f.pool.query('select issue_profile_key($1, $2)', [participantId, sha256hex(key)]);
  await page.goto(`/edit#${key}`);
  await expect(page).toHaveURL(`${E2E_ORIGIN}/me`);
  return { context, page };
}

test('T-CONN-09: an anonymous viewer of a shared badge link gets "Sign in to connect", not Connect', async ({ page }) => {
  await page.goto(`/t/${b.tag.T2.publicId}`);
  await expect(page.getByRole('link', { name: 'Sign in to connect' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Connect with/ })).toHaveCount(0);
});

test('F24: A taps Connect → "Sent!"; B taps back → "connected"; both see each other in My connections', async ({ browser }) => {
  const ada = await signedIn(browser, f.p.A);
  await ada.page.goto(`/t/${b.tag.T2.publicId}`);
  await ada.page.getByRole('button', { name: 'Connect with Benji' }).click();
  await expect(ada.page.getByRole('status').filter({ hasText: 'Sent!' })).toContainText('It counts once Benji taps your badge too.');
  await expect(ada.page.getByText('Waiting for Benji to tap your badge back.')).toBeVisible();

  const ben = await signedIn(browser, f.p.B);
  await ben.page.goto(`/t/${b.tag.T1.publicId}`);
  await ben.page.getByRole('button', { name: 'Connect with Ada F.' }).click();
  await expect(ben.page.getByRole('status').filter({ hasText: 'connected' })).toContainText('You’re connected with Ada F.');

  await ada.page.goto('/me/connections');
  const item = ada.page.getByRole('listitem').filter({ hasText: 'Benji' });
  await expect(item.getByRole('link', { name: 'LinkedIn' })).toHaveAttribute('href', 'https://www.linkedin.com/in/benji');
  await expect(item.getByRole('link', { name: 'View badge' })).toHaveAttribute('href', `/t/${b.tag.T2.publicId}`);
  await ada.context.close();
  await ben.context.close();
});
