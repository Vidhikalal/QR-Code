import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authStatePath, E2E_ORIGIN, saveSignedInState } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN F13/F14 and §10.3: events list, New event, event switcher.
const ADMIN = authStatePath('events-admin');
const ORG = authStatePath('events-org');
const VOL = authStatePath('events-vol');

test.describe.configure({ mode: 'serial' });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  f = await createStandardFixture();
  const admin = await f.addPlatformAdmin();
  // org1 organizes E1 and volunteers on E2: the switcher must list exactly those two.
  await f.pool.query(`insert into event_staff (event_id, user_id, role) values ($1, $2, 'volunteer')`, [f.e2.id, f.staff.org1]);
  await saveSignedInState(browser, admin.email, ADMIN);
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
  await saveSignedInState(browser, f.staffEmail.vol1, VOL);
});
test.afterAll(async () => {
  await f.close();
});

test('T-EVT-04 (E): an admin creates an event in the browser and lands on its checkpoints with a closed Door', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: ADMIN });
  const page = await context.newPage();
  await page.goto('/admin');
  await page.getByRole('link', { name: '+ New event' }).click();
  await expect(page).toHaveURL('/admin/new');
  const name = `E2E Night ${randomBytes(3).toString('hex')}`;
  await page.getByLabel('Event name').fill(name);
  const slug = await page.getByLabel(/^Slug/).inputValue();
  expect(slug).toBe(name.toLowerCase().replaceAll(' ', '-'));
  await page.getByLabel('Venue').fill('Bahen Centre');
  await page.getByLabel('Starts').fill('2026-12-05T09:00');
  await page.getByLabel('Ends').fill('2026-12-05T18:00');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(`/admin/${slug}/checkpoints`);
  await expect(page.getByRole('cell', { name: 'Door', exact: true })).toBeVisible();
  const { rows } = await f.pool.query<{ starts_at: Date }>('select starts_at from events where slug = $1', [slug]);
  expect(rows[0]?.starts_at.toISOString()).toBe('2026-12-05T14:00:00.000Z'); // 09:00 EST
  await context.close();
});

test('T-EVT-10 (E): a volunteer opening /admin/new gets 403 and no form', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: VOL });
  const res = await context.request.get('/admin/new', { maxRedirects: 0 });
  expect(res.status()).toBe(403);
  expect(await res.text()).not.toContain('Create event');
  await context.close();
});

test('T-EVT-11: the event switcher lists exactly the user’s events and navigates by role', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: ORG });
  const page = await context.newPage();
  await page.goto(`/admin/${f.slug}`);
  const switcher = page.getByTestId('event-switcher');
  const options = await switcher.locator('option').allTextContents();
  expect(options.sort()).toEqual([f.e1.name, `${f.e2.name} (volunteer: scanner)`].sort());
  await switcher.selectOption(`${f.slug}-2`);
  await expect(page).toHaveURL(`/scan/${f.slug}-2`);
  await context.close();
});

test('PLAN §10.3: after sign-in with no next, staff land on the events list', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: VOL });
  const page = await context.newPage();
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  await expect(page.getByRole('link', { name: f.e1.name })).toHaveAttribute('href', `/scan/${f.slug}`);
  await expect(page.getByRole('link', { name: '+ New event' })).toHaveCount(0);
  await context.close();
});
