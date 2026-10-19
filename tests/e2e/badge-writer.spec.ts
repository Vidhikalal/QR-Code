import { expect, test } from '@playwright/test';
import { authStatePath, installFakeNfc, nfcTap, nfcWrites, saveSignedInState, serialOf } from '../fixtures/e2e';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §11 Tools page (badge linker + tag writer) / §14.15. The e2e server runs with
// BADGE_ORIGIN=https://badges.example.test.
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

test('T-NFC-16: without Web NFC the Tools tab, the linker and the write control are not shown', async ({ page }) => {
  await page.goto(`/admin/${f.slug}`);
  await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Participants' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tools' })).toHaveCount(0);
  await page.goto(`/admin/${f.slug}/tools`);
  await expect(page.getByRole('heading', { name: 'Write tags' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Link a badge' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /writing/i })).toHaveCount(0);
});

test('T-NFC-16: the writer writes exactly one URL record and skips a tag that already holds its link', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/admin/${f.slug}`);
  await page.getByRole('link', { name: 'Tools' }).click();
  await expect(page.getByRole('heading', { name: 'Write tags' })).toBeVisible();
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

test('T-NFC-11: Tools links a badge to the person picked by name; the badge then scans as them', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/admin/${f.slug}`);
  await page.getByRole('link', { name: 'Tools' }).click();
  await page.getByPlaceholder('Type a name').fill('ben');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: 'Link a badge to Ben Fixture' }).click();
  const status = page.getByRole('status');
  await expect(status).toContainText('Tap the badge to link it to Ben Fixture');

  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  await expect(status).toContainText(`✓ Badge ${serialOf(uid)} linked to Ben Fixture`);
  await nfcTap(page, serialOf(randomUid())); // the reader stopped: a second tap links nothing
  await expect(status).toContainText(serialOf(uid));
  expect((await f.pool.query('select participant_id from badges where uid = $1', [uid])).rows).toEqual([{ participant_id: f.p.B }]);
  expect((await f.badgeScan({ cp: f.cp.R, staff: f.staff.vol1, uid })).code).toBe('ACCEPTED');
});

test('T-NFC-11: a badge the server refuses shows a red notice, never a green screen', async ({ page }) => {
  await installFakeNfc(page);
  await page.route('**/api/events/*/badges', (route) => route.fulfill({ json: { code: 'BADGE_TAKEN' } }));
  await page.goto(`/admin/${f.slug}/tools`);
  await page.getByPlaceholder('Type a name').fill('ada');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: 'Link a badge to Ada Fixture' }).click();
  await nfcTap(page, serialOf(randomUid()));
  await expect(page.getByRole('status')).toContainText('is linked to someone else');
  await expect(page.getByTestId('scan-result')).toHaveCount(0);
});
