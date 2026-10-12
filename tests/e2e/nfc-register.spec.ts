import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authStatePath, saveSignedInState } from '../fixtures/e2e';
import { installFakeNfc, tap } from '../fixtures/nfc';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN F19 A: the Register page with a (fake) Android NFC reader.
const ORG = authStatePath('nfc-register');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: ORG });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
});
test.afterAll(async () => {
  await f.close();
});

// Chip serials are unique across the whole database: a fixed one would collide on the next run.
const freshSerial = () => `04${randomBytes(6).toString('hex').toUpperCase()}`;

const newestTag = async () =>
  (await f.pool.query<{ public_id: string; uid: string | null; label: string }>('select public_id, uid, label from tags where event_id = $1 order by registered_at desc limit 1', [f.e1.id])).rows[0];
// Register reserves the NEXT id right after each badge (so the write is instant), so look a registered
// badge up by its chip serial rather than as the newest row.
const tagBySerial = async (uid: string) =>
  (await f.pool.query<{ public_id: string; uid: string | null; label: string }>('select public_id, uid, label from tags where event_id = $1 and uid = $2', [f.e1.id, uid])).rows[0];

test('T-NFC-06: tap a blank badge → reserve, write the URL, confirm the serial', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/admin/${f.slug}/badges/register`);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Ready: tap a blank badge')).toBeVisible();
  const serial = freshSerial();
  await tap(page, serial, null);
  await expect(page.getByRole('status').filter({ hasText: 'registered' })).toContainText(/B-\d{4} registered/);
  await expect(page.getByTestId('registered-count')).toContainText('1');
  const tag = await tagBySerial(serial);
  expect(tag?.uid).toBe(serial);
  const writes = await page.evaluate(() => (window as unknown as { __nfc: { writes: string[] } }).__nfc.writes);
  expect(writes).toEqual([expect.stringMatching(new RegExp(`/t/${tag?.public_id}$`))]);
});

test('T-NFC-06: a failed write leaves the reserved badge unconfirmed', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/admin/${f.slug}/badges/register`);
  await page.getByRole('button', { name: 'Start' }).click();
  await page.evaluate(() => {
    (window as unknown as { __nfc: { failWrite: boolean } }).__nfc.failWrite = true;
  });
  await tap(page, freshSerial(), null);
  await expect(page.getByRole('status').filter({ hasText: 'Hold the badge still' })).toBeVisible();
  expect((await newestTag())?.uid).toBeNull();
  await expect(page.getByTestId('registered-count')).toContainText('0');
});

test('Register: "Ready" only once Chrome has actually started NFC; a refusal says so', async ({ page, browser }) => {
  await installFakeNfc(page, { scan: 'pending' }); // Chrome still waiting (e.g. on its permission prompt)
  await page.goto(`/admin/${f.slug}/badges/register`);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Starting NFC')).toBeVisible();
  await expect(page.getByText('Ready: tap a blank badge')).toHaveCount(0);

  const denied = await browser.newPage({ storageState: ORG });
  await installFakeNfc(denied, { scan: 'deny' });
  await denied.goto(`/admin/${f.slug}/badges/register`);
  await denied.getByRole('button', { name: 'Start' }).click();
  await expect(denied.getByText(/NFC permission was refused/)).toBeVisible();
  await expect(denied.getByText('Ready: tap a blank badge')).toHaveCount(0);
  await denied.close();
});

test('Register: the URL is written the moment a badge touches the phone, without waiting on the server', async ({ page }) => {
  // Real phones: the badge leaves the field during a slow server round trip, and Chrome's write() then
  // waits silently for the next tap. So the id is reserved before the tap, when Start is pressed.
  await installFakeNfc(page);
  await page.goto(`/admin/${f.slug}/badges/register`);
  const reserved = page.waitForResponse((r) => r.url().includes('/tags/reserve'));
  await page.getByRole('button', { name: 'Start' }).click();
  await reserved; // the next badge id is ready before any tap
  await expect(page.getByText('Ready: tap a blank badge')).toBeVisible();
  await page.route('**/tags/reserve', () => undefined); // from now on the server never answers a reserve
  await tap(page, freshSerial(), null);
  await expect(page.getByRole('status').filter({ hasText: /Badge detected|registered/ })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __nfc: { writes: string[] } }).__nfc.writes.length)).toBe(1);
  await expect(page.getByRole('status').filter({ hasText: 'registered' })).toContainText(/B-\d{4} registered/);
});
