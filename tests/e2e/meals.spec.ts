import { expect, test } from '@playwright/test';
import { authStatePath, chooseCheckpoint, E2E_ORIGIN, fakeCameraArgs, saveSignedInState, warmDevServer } from '../fixtures/e2e';
import { installFakeNfc, tap } from '../fixtures/nfc';
import { createStandardFixture, type Badges, type StandardFixture } from '../fixtures/standard';

// PLAN F21/F22 (V5a): badge check-ins and repeat servings in the scanner.
const AUTH = authStatePath('meals');
test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: fakeCameraArgs() }, permissions: ['camera'], storageState: AUTH });

let f: StandardFixture;
let b: Badges;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  f = await createStandardFixture();
  b = await f.addBadges();
  await saveSignedInState(browser, f.staffEmail.vol1, AUTH);
  await warmDevServer(f.slug);
});
test.afterAll(async () => {
  await f.close();
});

test('T-MEAL-06: REPEAT_SERVING asks; Serve again resends with confirmRepeat and a NEW clientScanId; Don’t serve sends nothing', async ({ page }) => {
  const bodies: Array<Record<string, unknown>> = [];
  let reply: Record<string, unknown> = {};
  await page.route('**/api/scan', async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ json: { serverTime: new Date().toISOString(), ...reply } });
  });
  const ada = { id: 'p-ada', displayName: 'Ada Fixture', photoUrl: null, status: 'accepted', dietaryNotes: null };
  const previous = { scannedAt: new Date(Date.now() - 90_000).toISOString(), scannedByName: 'Maya', scannedByMe: false };
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Lunch');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
  const record = async () => {
    await page.getByRole('button', { name: 'Manual search' }).click();
    await page.getByPlaceholder('Type a name').fill('ada');
    await page.getByRole('button', { name: 'Record scan for Ada Fixture' }).click();
  };

  reply = { code: 'REPEAT_SERVING', participant: ada, servedCount: 1, previous };
  await record();
  const ask = page.getByRole('alertdialog', { name: 'SERVED 1× ALREADY' });
  await expect(ask).toContainText('by Maya');
  reply = { code: 'ACCEPTED', participant: ada, servingNo: 2, scanId: 's2', replayed: false };
  await ask.getByRole('button', { name: 'Serve again' }).click();
  await expect(page.getByTestId('scan-result')).toContainText('SERVE (2nd serving)');
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).not.toHaveProperty('confirmRepeat');
  expect(bodies[1]).toMatchObject({ method: 'manual', confirmRepeat: true });
  expect(bodies[1]?.clientScanId).not.toBe(bodies[0]?.clientScanId);
  await expect(page.getByTestId('scan-result')).toHaveCount(0, { timeout: 5000 });

  reply = { code: 'REPEAT_SERVING', participant: ada, servedCount: 2, previous };
  await record();
  await page.getByRole('alertdialog', { name: 'SERVED 2× ALREADY' }).getByRole('button', { name: 'Don’t serve' }).click();
  await expect(page.getByTestId('scan-result')).toHaveCount(0);
  expect(bodies).toHaveLength(3);
});

test('F21: an NFC badge tap at Lunch checks the wearer in by badge (real record_scan)', async ({ page }) => {
  await f.checkIn(f.p.B, f.token.B);
  await installFakeNfc(page);
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Lunch');
  await page.getByRole('button', { name: 'Start NFC' }).click();
  await tap(page, b.tag.T2.uid, `${E2E_ORIGIN}/t/${b.tag.T2.publicId}`);
  const result = page.getByTestId('scan-result');
  await expect(result).toHaveAttribute('data-tone', 'green');
  await expect(result).toContainText('SERVE');
  await expect(result).toContainText('Ben Fixture');
  const { rows } = await f.pool.query('select method, tag_id, serving_no from scans where participant_id = $1 and checkpoint_id = $2', [f.p.B, f.cp.L]);
  expect(rows).toEqual([{ method: 'nfc', tag_id: b.tag.T2.id, serving_no: 1 }]);
});
