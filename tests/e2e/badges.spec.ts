import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authStatePath, saveSignedInState } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN §10.3 / §11.5 (V4a): the organizer's Badges page and print sheet.
const ORG = authStatePath('badges-org');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: ORG });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  f = await createStandardFixture();
  await f.addBadges(); // T1–T8 on E1 (3 linked), T9 on E2
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
});
test.afterAll(async () => {
  await f.close();
});

test('PLAN §10.3: Badges shows counts and every badge of this event with its holder', async ({ page }) => {
  await page.goto(`/admin/${f.slug}/badges`);
  await expect(page.getByTestId('badges-registered')).toContainText('8');
  await expect(page.getByTestId('badges-linked')).toContainText('3');
  await expect(page.getByTestId('badges-unlinked')).toContainText('5');
  const row = page.getByRole('row', { name: /^T1 / });
  await expect(row).toContainText('Linked');
  await expect(row).toContainText('Ada Fixture');
  await expect(page.getByRole('cell', { name: 'T9', exact: true })).toHaveCount(0);
});

test('T-TAG-13 (E): importing a vendor CSV shows a result per row and adds the badges', async ({ page }) => {
  await page.goto(`/admin/${f.slug}/badges`);
  const id = randomBytes(9).toString('base64url');
  const csv = `public_id,uid,label\n${id},04${randomBytes(6).toString('hex')},V-1\nbroken,04AABBCCDDEEFF,\n`;
  await page.getByLabel(/Import vendor CSV/).setInputFiles({ name: 'vendor.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const results = page.getByRole('table', { name: 'Import results' });
  await expect(results).toContainText('REGISTERED');
  await expect(results).toContainText('INVALID:public_id');
  await expect(page.getByTestId('badges-registered')).toContainText('9');
});

test('PLAN §11.5: the print sheet renders one QR per active badge', async ({ page }) => {
  await page.goto(`/admin/${f.slug}/badges/print`);
  await expect(page.getByTestId('badge-qr')).toHaveCount(9);
  await expect(page.getByText('T1', { exact: true })).toBeVisible();
});
