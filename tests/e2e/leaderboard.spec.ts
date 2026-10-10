import { expect, test } from '@playwright/test';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { authStatePath, E2E_ORIGIN, saveSignedInState } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN F25 (V7): the projector screen, Freeze on the dashboard, points on /me.
const ORG = authStatePath('leaderboard-org');

test.describe.configure({ mode: 'serial' });
test.use({ storageState: ORG });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
  await f.scan({ cp: f.cp.G, staff: f.staff.vol1, participantId: f.p.A }); // Ada: 5 activity points
});
test.afterAll(async () => {
  await f.close();
});

const boardRequests = (url: string) => /\/api\/admin\/[^/]+\/leaderboard\?kind=/.test(url);

test('T-LB-09: with hourly refresh, the projector refetches once the next window opens, not before', async ({ page }) => {
  await f.pool.query('update events set leaderboard_refresh_minutes = 60, leaderboard_frozen_at = null where id = $1', [f.e1.id]);
  let n = 0;
  page.on('request', (r) => {
    if (boardRequests(r.url())) n++;
  });
  await page.clock.install();
  await page.goto(`/admin/${f.slug}/screen`);
  await expect(page.getByTestId('projector').getByRole('status')).toContainText(/Next update at \d{1,2}:\d{2} [AP]M E[DS]T/);
  expect(n).toBe(2); // one per board
  await page.clock.runFor('30:00');
  expect(n).toBe(2);
  await page.clock.runFor('31:00'); // past nextRefreshAt (≤ 60 min away)
  await expect.poll(() => n).toBe(4);
});

test('F25: live mode (refresh 0) shows the top of each board; Freeze stops it, from the dashboard with a confirm', async ({ page }) => {
  await f.pool.query('update events set leaderboard_refresh_minutes = 0, leaderboard_frozen_at = null where id = $1', [f.e1.id]);
  await page.goto(`/admin/${f.slug}/screen`);
  const projector = page.getByTestId('projector');
  await expect(projector.getByTestId('row-activity').first()).toContainText('Ada F.');
  await expect(projector.getByTestId('row-activity').first()).toContainText('5 pts');
  await expect(projector.getByRole('status')).toHaveText('Live');

  await page.goto(`/admin/${f.slug}`);
  await expect(page.getByTestId('board-activity')).toContainText('Ada F. · 5 pts');
  await page.getByRole('button', { name: 'Freeze leaderboards' }).click();
  await page.getByRole('dialog', { name: 'Freeze the leaderboards?' }).getByRole('button', { name: 'Freeze' }).click();
  await expect(page.getByRole('button', { name: 'Unfreeze leaderboards' })).toBeVisible();
  await expect(page.getByText(/^Frozen at /)).toBeVisible();

  await f.checkIn(f.p.B);
  await f.scan({ cp: f.cp.W, staff: f.staff.vol1, participantId: f.p.B }); // Ben, 10 points after the freeze: not on the screen
  await page.goto(`/admin/${f.slug}/screen`);
  await expect(projector.getByRole('status')).toHaveText('Final results');
  await expect(projector.getByTestId('row-activity')).toHaveCount(1);

  await page.goto(`/admin/${f.slug}`);
  await page.getByRole('button', { name: 'Unfreeze leaderboards' }).click();
  await expect(page.getByTestId('board-activity')).toContainText('Ben F. · 10 pts');
});

test('F25: /me shows my live points and my rank on the screen', async ({ browser }) => {
  await f.pool.query('update events set leaderboard_refresh_minutes = 0, leaderboard_frozen_at = null where id = $1', [f.e1.id]);
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const key = generateSecret();
  await f.pool.query('select issue_profile_key($1, $2)', [f.p.A, sha256hex(key)]);
  await page.goto(`/edit#${key}`);
  await expect(page).toHaveURL(`${E2E_ORIGIN}/me`);
  const card = page.getByTestId('my-points');
  await expect(card).toContainText('Activity: 5 pts · Networking: 0 pts');
  await expect(card).toContainText('On the screen you’re #2 in Activity.');
  await context.close();
});
