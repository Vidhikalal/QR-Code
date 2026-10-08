import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { E2E_ORIGIN } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN F17/F18 on the (single, dev) ME host: /edit#key → session cookie → /me.
test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] } });

let f: StandardFixture;
test.beforeAll(async () => {
  f = await createStandardFixture();
});
test.afterAll(async () => {
  await f.close();
});

async function freshKey(participantId: string): Promise<string> {
  const key = generateSecret();
  await f.pool.query('select issue_profile_key($1, $2)', [participantId, sha256hex(key)]);
  return key;
}

test('T-SESS-06: /edit strips the key from the URL before the POST, signs in, and the key never reaches the server log', async ({ page }) => {
  const person = await f.addParticipant(f.e1.id);
  const key = await freshKey(person.id);
  const urlsAtPost: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/me/session' && r.method() === 'POST') urlsAtPost.push(page.url());
  });
  await page.goto(`/edit#${key}`);
  await expect(page).toHaveURL(`${E2E_ORIGIN}/me`);
  await expect(page.getByRole('heading', { name: 'Hi Extra' })).toBeVisible();
  expect(urlsAtPost).toEqual([`${E2E_ORIGIN}/edit`]);
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'pl_me')).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  expect(readFileSync('.e2e/server.log', 'utf8')).not.toContain(key);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'You’re not signed in' })).toBeVisible();
});

test('F17: a replaced link and a broken link explain themselves; nothing is shown about the person', async ({ page }) => {
  const person = await f.addParticipant(f.e1.id);
  const key = await freshKey(person.id);
  await f.pool.query('select rotate_profile_keys($1, $2)', [person.id, sha256hex(generateSecret())]);
  await page.goto(`/edit#${key}`);
  // Next's route announcer is also role="alert", so match by text.
  await expect(page.getByRole('alert').filter({ hasText: 'This link was replaced' })).toBeVisible();
  await page.goto('about:blank'); // a hash-only change on /edit would not reload the page
  await page.goto(`/edit#${generateSecret()}`);
  await expect(page.getByRole('alert').filter({ hasText: 'This link doesn’t work' })).toBeVisible();
  await expect(page.getByText('Extra')).toHaveCount(0);
});

test('F18: Get a new link asks first, then signs this device out', async ({ page }) => {
  const person = await f.addParticipant(f.e1.id);
  await page.goto(`/edit#${await freshKey(person.id)}`);
  await expect(page.getByRole('heading', { name: 'Hi Extra' })).toBeVisible();
  await page.getByRole('button', { name: 'Get a new link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Get a new link?' });
  await expect(dialog).toContainText('signs out every device');
  await dialog.getByRole('button', { name: 'Get a new link' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email for your new link');
  await expect(page.getByRole('heading', { name: 'You’re not signed in' })).toBeVisible();
  const { rows } = await f.pool.query<{ n: number }>(`select count(*)::int as n from email_outbox where participant_id = $1 and kind = 'profile_link'`, [person.id]);
  expect(rows[0]?.n).toBe(1);
});

test('T-SESS-10 (E): an in-app browser gets the open-in-browser banner on /me', async ({ browser }) => {
  const person = await f.addParticipant(f.e1.id);
  const context = await browser.newContext({
    baseURL: E2E_ORIGIN,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0 (iPhone15,2; iOS 18_0; en_CA)',
  });
  const page = await context.newPage();
  await page.goto(`/edit#${await freshKey(person.id)}`);
  await expect(page.getByRole('note')).toContainText('Instagram’s built-in browser');
  await context.close();
});
