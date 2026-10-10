import { expect, test } from '@playwright/test';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { authStatePath, E2E_ORIGIN, saveSignedInState } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN F26 (V8): the Recap page, and the recap's /edit?next=/me/connections link.
const ORG = authStatePath('recap-org');
const HOUR = 3_600_000;

test.describe.configure({ mode: 'serial' });
test.use({ storageState: ORG });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
  await f.checkIn(f.p.A, f.token.A);
  await f.pool.query('update events set starts_at = $2, ends_at = $3, badge_unlock_password = null where id = $1', [f.e1.id, new Date(Date.now() + HOUR), new Date(Date.now() + 5 * HOUR)]);
});
test.afterAll(async () => {
  await f.close();
});

test('F26: unknown placeholder is flagged; save, preview for an attendee; Send waits for the end and the password, then queues', async ({ page }) => {
  await page.goto(`/admin/${f.slug}/recap`);
  const box = page.getByLabel('Message');
  await box.fill('Thanks {nickname}! You won {prize}.');
  await expect(page.getByRole('alert').filter({ hasText: 'Unknown placeholder' })).toContainText('{prize}');
  await expect(page.getByRole('button', { name: 'Send recaps' })).toBeDisabled();
  await box.fill('Thanks {nickname}! {workshops} workshops at {event}.');
  await page.getByRole('button', { name: 'Save message' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Message saved' })).toBeVisible();

  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText(`Thanks for coming to ${f.e1.name}!`)).toBeVisible();
  await expect(page.getByTestId('recap-text')).toContainText(`Thanks Ada! 0 workshops at ${f.e1.name}.`);
  await expect(page.getByTitle('Recap email preview')).toHaveAttribute('sandbox', '');
  await expect(page.getByRole('button', { name: 'Send recaps' })).toBeDisabled();
  await expect(page.getByText(/You can send recaps after the event ends/)).toBeVisible();

  await f.pool.query(`update events set starts_at = $2, ends_at = $3, badge_unlock_password = 'tap-tap-42' where id = $1`, [f.e1.id, new Date(Date.now() - 6 * HOUR), new Date(Date.now() - HOUR)]);
  await page.reload();
  await page.getByRole('button', { name: 'Send recaps' }).click();
  await page.getByRole('dialog', { name: 'Send recaps?' }).getByRole('button', { name: 'Send recaps' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Queued 1 recap\b/ })).toBeVisible();
  await page.getByRole('button', { name: 'Send recaps' }).click();
  await page.getByRole('dialog', { name: 'Send recaps?' }).getByRole('button', { name: 'Send recaps' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'already has a recap' })).toBeVisible();
});

test('PLAN §12.4: /edit?next=/me/connections#key signs in and lands on My connections, with the key and query gone', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const key = generateSecret();
  await f.pool.query('select issue_profile_key($1, $2)', [f.p.B, sha256hex(key)]);
  await page.goto(`/edit?next=/me/connections#${key}`);
  await expect(page).toHaveURL(`${E2E_ORIGIN}/me/connections`);
  await context.close();
});
