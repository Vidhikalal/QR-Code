import { expect, test } from '@playwright/test';
import { authStatePath, installFakeNfc, nfcTap, nfcWrites, saveSignedInState, serialOf } from '../fixtures/e2e';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §11 Badges page / §14.15. The e2e server runs with BADGE_ORIGIN=https://badges.example.test.
const ORG = authStatePath('badge-writer-org');
const ORIGIN = 'https://badges.example.test';
test.describe.configure({ mode: 'serial' });
test.use({ storageState: ORG });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
});
test.afterAll(async () => {
  await f.close();
});

test('T-NFC-16: without Web NFC the Badges tab and the write control are not shown', async ({ page }) => {
  await page.goto(`/admin/${f.slug}`);
  await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Participants' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Badges' })).toHaveCount(0);
  await page.goto(`/admin/${f.slug}/badges`);
  await expect(page.getByRole('heading', { name: 'Badges' })).toBeVisible();
  await expect(page.getByRole('button', { name: /writing/i })).toHaveCount(0);
});

test('T-NFC-16: the writer writes exactly one URL record and skips a tag that already holds its link', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/admin/${f.slug}`);
  await page.getByRole('link', { name: 'Badges' }).click();
  await expect(page.getByRole('heading', { name: 'Badges' })).toBeVisible();
  await page.getByRole('button', { name: 'Start writing' }).click();
  await expect(page.getByRole('button', { name: 'Writing: tap to stop' })).toHaveAttribute('aria-pressed', 'true');

  const uid = randomUid();
  const link = `${ORIGIN}/profile/${uid}?tap`;
  const status = page.getByRole('status');
  await nfcTap(page, serialOf(uid));
  await expect(status).toContainText('Wrote the link');
  expect(await nfcWrites(page)).toEqual([{ records: [{ recordType: 'url', data: link }] }]);

  await nfcTap(page, serialOf(uid), [link]);
  await expect(status).toContainText('already has its link');
  expect(await nfcWrites(page)).toHaveLength(1);
});
