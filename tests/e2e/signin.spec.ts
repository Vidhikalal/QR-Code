import { expect, test } from '@playwright/test';
import { authStatePath, E2E_ORIGIN, saveSignedInState } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN F18 recovery: staff hand-off sign-in code (QR) and "Email me a link".
const ORG = authStatePath('signin-org');
test.describe.configure({ mode: 'serial' });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
});
test.afterAll(async () => {
  await f.close();
});

test('T-SESS-07 (E): an organizer shows a sign-in QR; opening it signs the participant in with the code stripped first', async ({ browser }) => {
  const staff = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: ORG });
  const page = await staff.newPage();
  await page.goto(`/admin/${f.slug}/participants`);
  await page.getByRole('row', { name: /Ada Fixture/ }).getByRole('button', { name: 'Details for Ada Fixture' }).click();
  await page.getByRole('region', { name: 'Ada Fixture' }).getByRole('button', { name: 'Show sign-in code' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign-in code for Ada Fixture' });
  const qr = dialog.getByTestId('signin-qr');
  await expect(qr).toBeVisible();
  await expect(dialog.getByRole('timer')).toContainText(/Valid for [12]:\d\d/);
  const url = (await qr.getAttribute('data-url')) ?? '';
  expect(url).toMatch(new RegExp(`^${E2E_ORIGIN}/signin#[A-Za-z0-9_-]{43}$`));
  await staff.close();

  const phone = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const p = await phone.newPage();
  const urlsAtPost: string[] = [];
  p.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/me/session/code') urlsAtPost.push(p.url());
  });
  await p.goto(url);
  await expect(p.getByRole('heading', { name: 'Hi Ada' })).toBeVisible();
  expect(urlsAtPost).toEqual([`${E2E_ORIGIN}/signin`]);
  // Single use: the same link again explains itself.
  await p.goto('about:blank');
  await p.goto(url);
  await expect(p.getByRole('alert').filter({ hasText: 'expired or was already used' })).toBeVisible();
  await phone.close();
});

test('T-SESS-08 (E): Email me a link shows the same generic confirmation and queues the email', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const { rows } = await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.B]);
  await page.goto('/signin');
  await page.getByLabel('Event').selectOption(f.slug);
  await page.getByLabel('Email').fill(rows[0]?.email ?? '');
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByRole('status')).toContainText(`If that email is registered for ${f.e1.name}, we’ve sent a link.`);
  const queued = await f.pool.query(`select 1 from email_outbox where participant_id = $1 and kind = 'profile_link'`, [f.p.B]);
  expect(queued.rows).toHaveLength(1);
  await context.close();
});
