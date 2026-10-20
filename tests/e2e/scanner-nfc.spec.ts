import { expect, test, type Page } from '@playwright/test';
import {
  authStatePath,
  chooseCheckpoint,
  fakeCameraArgs,
  forceGc,
  installFakeNfc,
  nfcTap,
  nfcUnreadable,
  saveSignedInState,
  serialOf,
  warmDevServer,
} from '../fixtures/e2e';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §10.5 / §14.15: badge scanning in the scanner, with a fake Web NFC reader (CLAUDE.md mock list).
const AUTH = authStatePath('scanner-nfc');
test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: [...fakeCameraArgs(), '--js-flags=--expose-gc'] }, permissions: ['camera'], storageState: AUTH });

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

test('T-NFC-11: the scanner offers no Link badge after a door ADMIT (v0.5: attendees claim their own, organizers use Tools)', async ({ page }) => {
  await installFakeNfc(page);
  await openScanner(page);
  await readerOn(page);
  await manualDoorScan(page, 'ben', 'Ben Fixture');
  await expect(page.getByRole('button', { name: /Link badge/ })).toHaveCount(0);
});

test('T-NFC-10: a badge read vibrates at once, before the answer; until the page is tapped, the scanner says to tap once', async ({ page }) => {
  await installFakeNfc(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __vibrations: unknown[] };
    w.__vibrations = [];
    // Playwright's own locator checks count as user activation, so fake Chrome's sticky activation: only a click sets it.
    let tapped = false;
    for (const e of ['click', 'keydown']) window.addEventListener(e, () => (tapped = true), true);
    Object.defineProperty(navigator, 'userActivation', { value: { get hasBeenActive() { return tapped; }, get isActive() { return tapped; } } });
    Object.defineProperty(navigator, 'vibrate', {
      value: (pattern: unknown) => {
        w.__vibrations.push(pattern);
        return true;
      },
    });
  });
  const vibrations = () => page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations);
  const { uid } = await f.linkBadge(f.p.A);
  let release: () => void = () => undefined;
  const answer = new Promise<void>((r) => (release = r));
  await page.route('**/api/scan', async (route) => {
    await answer; // hold the server's answer back
    await route.continue();
  });

  await page.goto(`/scan/${f.slug}`);
  const hint = page.getByText('Tap the screen once so the phone can vibrate when it reads a badge.');
  await expect(hint).toBeVisible();
  await page.keyboard.press('Shift'); // an activation that changes nothing else: only the activation listener can hide it
  await expect(hint).toBeHidden();
  await chooseCheckpoint(page, 'Raffle');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
  await readerOn(page);

  await nfcTap(page, serialOf(uid));
  await expect.poll(vibrations).toEqual([[30, 60, 30]]);
  const result = page.getByTestId('scan-result');
  await expect(result).toBeHidden(); // the tick came before any answer
  release();
  await expect(result).toHaveAttribute('data-tone', 'green');
  expect(await vibrations()).toEqual([[30, 60, 30], [60]]);

  // An unreadable tag while the green result is up is ignored (no amber over green); once it's gone, amber + notice.
  await nfcUnreadable(page);
  expect(await vibrations()).toEqual([[30, 60, 30], [60]]);
  await expect(page.getByText('Couldn’t read that badge')).toHaveCount(0);
  await expect(result).toBeHidden({ timeout: 4000 });
  await nfcUnreadable(page);
  await expect(page.getByText('Couldn’t read that badge. Hold it still and try again.')).toBeVisible();
  expect(await vibrations()).toEqual([[30, 60, 30], [60], [80, 80, 80]]);
});

test('T-NFC-10: taps still arrive after a garbage collection (a collected reader swallowed every tap on a real phone)', async ({ page }) => {
  await installFakeNfc(page);
  const { uid } = await f.linkBadge(f.p.B);
  await openScanner(page, 'Raffle');
  await readerOn(page);
  expect(await page.evaluate(() => typeof (window as unknown as { gc?: unknown }).gc)).toBe('function');
  await forceGc(page);
  await nfcTap(page, serialOf(uid));
  await expect(page.getByTestId('scan-result')).toHaveAttribute('data-tone', 'green');
});

