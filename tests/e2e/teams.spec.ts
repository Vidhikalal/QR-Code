import { expect, test, type Browser } from '@playwright/test';
import { E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F15 / §11 Teams (v0.7): organizers open forming and release tracks; hackers team up from their menu.
let f: StandardFixture;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  f = await createStandardFixture();
});
test.afterAll(async () => {
  await f.close();
});

const emailOf = async (participantId: string) =>
  (await f.pool.query<{ email: string }>('select email from participants where id = $1', [participantId])).rows[0]?.email ?? '';

async function hacker(browser: Browser, participantId: string) {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await context.newPage();
  const email = await emailOf(participantId);
  await createAccount(email);
  await signIn(page, email, '/me');
  return { context, page };
}

test('T-TEAM-07: tracks and forming from the admin page; A creates a team, B joins with its code, A picks the released track', async ({ page, browser }) => {
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}/teams`);
  await page.getByLabel('Add tracks, one per line').fill('Best AI/ML Project\nBest Hardware Project');
  await page.getByRole('button', { name: 'Add tracks' }).click();
  await expect(page.getByText('✓ Tracks added.')).toBeVisible();

  // Before forming opens, the Team page says so and offers nothing.
  const a = await hacker(browser, f.p.A);
  await a.page.getByRole('link', { name: 'Team' }).click();
  await expect(a.page.getByText('Teams open on hackathon day.')).toBeVisible();
  await expect(a.page.getByRole('button', { name: 'Create team' })).toHaveCount(0);

  await page.getByLabel('Team forming open').check();
  await expect(page.getByText('✓ Team forming is open.')).toBeVisible();

  await a.page.reload();
  await a.page.getByLabel('Team name').fill('Data Wizards');
  await a.page.getByRole('button', { name: 'Create team' }).click();
  await expect(a.page.getByText('✓ Team created.')).toBeVisible();
  const code = (await a.page.getByText(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/).innerText()).replace('-', '');
  await expect(a.page.getByText('Tracks are announced at the hackathon.')).toBeVisible();

  // B types the code in lowercase.
  const b = await hacker(browser, f.p.B);
  await b.page.goto('/me/team');
  await b.page.getByLabel('Join code').fill(code.toLowerCase());
  await b.page.getByRole('button', { name: 'Join team' }).click();
  await expect(b.page.getByText('✓ You joined the team.')).toBeVisible();
  await expect(b.page.getByRole('heading', { name: 'Data Wizards' })).toBeVisible();
  await expect(b.page.getByText('Ada Fixture')).toBeVisible();

  await page.getByLabel('Tracks released').check();
  await expect(page.getByText('✓ Tracks released.')).toBeVisible();
  await a.page.reload();
  await a.page.getByLabel('Your team’s track').selectOption({ label: 'Best Hardware Project' });
  await a.page.getByRole('button', { name: 'Save track' }).click();
  await expect(a.page.getByText('✓ Track saved.')).toBeVisible();

  // The organizer sees the team, both members and the track.
  await page.reload();
  const team = page.getByRole('region', { name: 'Team Data Wizards' });
  await expect(team.getByText('Ada Fixture')).toBeVisible();
  await expect(team.getByText('Ben Fixture')).toBeVisible();
  await expect(team.getByLabel('Track of Data Wizards')).toHaveValue(/.+/);
  await expect(team.getByLabel('Track of Data Wizards').locator('option:checked')).toHaveText('Best Hardware Project');
  await a.context.close();
  await b.context.close();
});
