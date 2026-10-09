import { expect, test } from '@playwright/test';
import { authStatePath, saveSignedInState } from '../fixtures/e2e';
import { createStandardFixture, type Badges, type StandardFixture } from '../fixtures/standard';

// PLAN F21 / §8.2 / §13 (V5b): badge-page station check-ins, involvement, meal first servings vs seconds.
const ORG = authStatePath('station-org');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: ORG });

let f: StandardFixture;
let b: Badges;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  f = await createStandardFixture();
  b = await f.addBadges();
  await f.checkIn(f.p.B, f.token.B);
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
});
test.afterAll(async () => {
  await f.close();
});

test('T-BADGE-08: no station → picker → Check in to Lunch → SERVE; again → SERVED 1× ALREADY → Serve again → 2nd serving', async ({ page }) => {
  await page.goto(`/t/${b.tag.T2.publicId}`);
  const panel = page.getByLabel('Staff panel');
  await expect(panel).toContainText('Which checkpoint are you working?');
  await panel.getByRole('button', { name: 'Lunch', exact: true }).click();
  await panel.getByRole('button', { name: 'Check in to Lunch' }).click();
  const result = panel.getByTestId('station-result');
  await expect(result).toHaveAttribute('data-tone', 'green');
  await expect(result).toContainText('SERVE');
  const { rows } = await f.pool.query('select method, tag_id, serving_no from scans where participant_id = $1 and checkpoint_id = $2', [f.p.B, f.cp.L]);
  expect(rows).toEqual([{ method: 'nfc', tag_id: b.tag.T2.id, serving_no: 1 }]);

  await panel.getByRole('button', { name: 'Check in to Lunch' }).click();
  await expect(result).toHaveAttribute('data-tone', 'amber');
  await expect(result).toContainText('SERVED 1× ALREADY');
  await result.getByRole('button', { name: 'Serve again' }).click();
  await expect(result).toContainText('SERVE (2nd serving)');
  await expect(panel.getByLabel('Involvement')).toContainText('Lunch: 2 servings');

  // The station is remembered server-side for this staff member.
  await page.reload();
  await expect(page.getByLabel('Staff panel').getByRole('button', { name: 'Check in to Lunch' })).toBeVisible();
});

test('PLAN §13: the dashboard splits Lunch into first servings and seconds; Seconds open toggles and persists', async ({ page }) => {
  await page.goto(`/admin/${f.slug}`);
  const row = page.getByRole('row', { name: /^Lunch meal / }); // the checkpoints table's row
  await expect(row).toContainText('Ask first');
  const cells = row.getByRole('cell');
  await expect(cells.nth(6)).toHaveText('1'); // first servings
  await expect(cells.nth(7)).toHaveText('1'); // seconds
  await row.getByRole('button', { name: 'Open seconds' }).click();
  await expect(row.getByRole('button', { name: 'Close seconds' })).toBeVisible();
  const { rows } = await f.pool.query('select seconds_open from checkpoints where id = $1', [f.cp.L]);
  expect(rows).toEqual([{ seconds_open: true }]);
});
