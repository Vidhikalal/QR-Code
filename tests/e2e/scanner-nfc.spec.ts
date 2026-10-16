import { expect, test, type Page } from '@playwright/test';
import {
  authStatePath,
  chooseCheckpoint,
  fakeCameraArgs,
  installFakeNfc,
  nfcTap,
  saveSignedInState,
  serialOf,
  warmDevServer,
} from '../fixtures/e2e';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §10.5 / §14.15: badge scanning in the scanner, with a fake Web NFC reader (CLAUDE.md mock list).
const AUTH = authStatePath('scanner-nfc');
test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: fakeCameraArgs() }, permissions: ['camera'], storageState: AUTH });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.vol1, AUTH);
  await warmDevServer(f.slug);
});
test.afterAll(async () => {
  await f.close();
});

async function openScanner(page: Page, checkpoint = 'Door') {
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, checkpoint);
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
}

async function readerOn(page: Page) {
  await page.getByRole('button', { name: 'Badge reader: off' }).click();
  await expect(page.getByRole('button', { name: 'Badge reader: on' })).toHaveAttribute('aria-pressed', 'true');
}

async function manualDoorScan(page: Page, query: string, name: string) {
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill(query);
  await page.getByRole('button', { name: `Record scan for ${name}` }).click();
  const result = page.getByTestId('scan-result');
  await expect(result).toContainText('ADMIT');
  await expect(result).toBeHidden({ timeout: 4000 });
}

test('T-NFC-10: without Web NFC there are no badge controls at all', async ({ page }) => {
  await openScanner(page);
  await expect(page.getByRole('button', { name: /badge/i })).toHaveCount(0);
});

test('T-NFC-10: a linked badge scans through the real API; repeats, unreadable tags and offline taps send nothing', async ({ page, context }) => {
  await installFakeNfc(page);
  const { uid } = await f.linkBadge(f.p.A);
  const bodies: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) bodies.push(r.postData() ?? '');
  });
  await openScanner(page);
  await readerOn(page);

  const result = page.getByTestId('scan-result');
  await nfcTap(page, serialOf(uid));
  await expect(result).toHaveAttribute('data-tone', 'green');
  await expect(result).toContainText('ADMIT');
  await nfcTap(page, serialOf(uid)); // same badge again while the result is up
  await expect(result).toBeHidden({ timeout: 4000 });
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ method: 'nfc', badgeUid: uid });

  await nfcTap(page, ''); // a tag that reports no UID
  await expect(result).toContainText('Not a Passline code');
  await expect(result).toBeHidden({ timeout: 3000 });

  await context.setOffline(true);
  await expect(page.getByText('OFFLINE: use paper list')).toBeVisible();
  await nfcTap(page, serialOf(randomUid()));
  await expect(result).toBeHidden();
  await context.setOffline(false);
  expect(bodies).toHaveLength(1);
});

test('T-NFC-11: Link badge after a door ADMIT; the badge then works at another checkpoint', async ({ page }) => {
  await installFakeNfc(page);
  await openScanner(page);
  await readerOn(page);
  await manualDoorScan(page, 'ben', 'Ben Fixture');

  await page.getByRole('button', { name: 'Link badge to Ben Fixture' }).click();
  const notice = page.getByRole('status');
  await expect(notice).toContainText('Tap the badge');
  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  await expect(notice).toContainText('✓ Badge linked to Ben Fixture');
  await expect(page.getByTestId('scan-result')).toBeHidden();

  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Raffle/ }).click();
  await page.getByRole('button', { name: 'Switch to Raffle' }).click();
  await expect(page.getByTestId('checkpoint-banner')).toContainText('Raffle');
  await nfcTap(page, serialOf(uid));
  await expect(page.getByTestId('scan-result')).toContainText('RECORDED');
  await expect(page.getByTestId('scan-result')).toContainText('Ben Fixture');
});

test('T-NFC-11: Link badge survives a badge tapped too early, a repeated read, and a QR rescan at the door', async ({ page }) => {
  await installFakeNfc(page);
  const scans: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) scans.push(r.method());
  });
  await openScanner(page);
  await readerOn(page);
  await manualDoorScan(page, 'rae', 'Rae Fixture');

  const uid = randomUid();
  const result = page.getByTestId('scan-result');
  await nfcTap(page, serialOf(uid)); // handed the badge before anyone pressed "Link badge"
  await expect(result).toContainText('UNKNOWN BADGE');
  await result.click();
  await page.getByRole('button', { name: 'Link badge to Rae Fixture' }).click();
  await nfcTap(page, serialOf(uid));
  await expect(page.getByRole('status')).toContainText('✓ Badge linked to Rae Fixture');

  const before = scans.length;
  await nfcTap(page, serialOf(uid)); // Android reporting the same tap again
  await page.waitForTimeout(500);
  expect(scans.length).toBe(before);
  await expect(result).toBeHidden();

  // Rescanning the person at the door (ALREADY_SCANNED) offers Link badge again.
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('rae');
  await page.getByRole('button', { name: 'Record scan for Rae Fixture' }).click();
  await expect(result).toContainText('You scanned this');
  await result.click();
  await expect(page.getByRole('button', { name: 'Link badge to Rae Fixture' })).toBeVisible();
});

test('T-NFC-11: a badge that belongs to someone else shows a notice, never a green screen', async ({ page }) => {
  await installFakeNfc(page);
  await page.route('**/api/events/*/badges', (route) => route.fulfill({ json: { code: 'BADGE_TAKEN' } }));
  await openScanner(page);
  await readerOn(page);
  await manualDoorScan(page, 'nia', 'Nia Fixture');
  await page.getByRole('button', { name: 'Link badge to Nia Fixture' }).click();
  await nfcTap(page, serialOf(randomUid()));
  await expect(page.getByRole('status')).toContainText('belongs to someone else');
  await expect(page.getByTestId('scan-result')).toBeHidden();
});
