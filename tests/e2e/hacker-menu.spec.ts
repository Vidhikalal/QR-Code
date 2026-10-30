import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F14 (v0.6): the hacker menu: own badge → menu → profile, schedule, emergency contact, pass.
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

test('T-ADM-08: an organizer writes the schedule and emergency info on the Info page', async ({ page }) => {
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}`);
  await page.getByRole('link', { name: 'Info', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Info for hackers' })).toBeVisible();
  await page.getByLabel('Schedule').fill('Sat 9:00  Doors\nSat 12:00  Lunch');
  await page.getByLabel('Emergency info').fill('Call Ade: 416 555 0199');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('✓ Saved. Hackers see it in their menu.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Schedule')).toHaveValue('Sat 9:00  Doors\nSat 12:00  Lunch');
});

test('T-ME-07 / T-NFC-22: A taps their own badge → menu → edits profile and emergency contact, reads the schedule; others see the badge as before', async ({ browser }) => {
  const { uid } = await f.linkBadge(f.p.A);
  const a = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await a.newPage();
  await createAccount(await emailOf(f.p.A));
  // Signed out, the menu sends you to sign in and back (proxy.ts covers /me/*).
  await page.goto('/me/profile');
  await expect(page).toHaveURL(/\/login\?next=%2Fme%2Fprofile/);
  await signIn(page, await emailOf(f.p.A), `/profile/${uid}?tap`);
  await page.waitForURL('**/me'); // no event slug in the URL (v0.6.1)

  const menu = page.getByRole('navigation', { name: 'Hacker menu' });
  for (const item of ['Hacker profile', 'Schedule', 'Emergency contact']) await expect(menu.getByRole('link', { name: item })).toBeVisible();
  await expect(menu.getByText('My pass')).toBeVisible();
  await expect(menu.getByText('In your email')).toBeVisible(); // A's fixture pass predates derived tokens
  await expect(menu.getByText('Finish setting up')).toBeVisible(); // v0.9: no profile setup yet

  await menu.getByRole('link', { name: 'Hacker profile' }).click();
  await expect(page.getByText('Ada Fixture')).toBeVisible();
  await expect(page.getByText('✓ Badge linked.', { exact: true })).toBeVisible();
  // v0.8.2: dietary notes are the Sheet's, for organizers only; saving the profile must not clear them.
  await expect(page.getByLabel('Dietary notes')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save links' }).click();
  await expect(page.getByText('✓ Saved.')).toBeVisible();

  await page.getByRole('link', { name: '← Menu' }).click();
  await expect(page.getByRole('link', { name: 'Schedule', exact: true })).toHaveAttribute('href', '#schedule');
  await page.getByRole('link', { name: 'Schedule', exact: true }).click();
  await expect(page).toHaveURL(/\/me#schedule$/);
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeInViewport();
  await expect(page.getByText(/Sat 9:00\s+Doors\s+Sat 12:00\s+Lunch/)).toBeVisible();
  expect(await page.getByText(/Sat 9:00/).evaluate((el) => (el as HTMLElement).innerText)).toContain('Doors\nSat 12:00'); // line breaks kept

  await page.getByRole('link', { name: 'Emergency contact' }).click();
  await expect(page.getByText('Call Ade: 416 555 0199')).toBeVisible();
  await page.getByLabel('Name').fill('Sam Fixture');
  // A phone that isn't one is caught in the browser: nothing is sent and the typed name stays.
  await page.getByLabel('Phone').fill('call me maybe');
  await page.getByRole('button', { name: 'Save' }).click();
  expect(await page.getByLabel('Phone').evaluate((el) => (el as HTMLInputElement).validity.patternMismatch)).toBe(true);
  await expect(page.getByLabel('Name')).toHaveValue('Sam Fixture');
  for (const ok of ['+1 (416) 555-0100', '416.555.0100']) {
    await page.getByLabel('Phone').fill(ok);
    expect(await page.getByLabel('Phone').evaluate((el) => (el as HTMLInputElement).validity.valid), ok).toBe(true);
  }
  await page.getByLabel('Phone').fill('12');
  expect(await page.getByLabel('Phone').evaluate((el) => (el as HTMLInputElement).validity.valid)).toBe(false);
  await page.getByLabel('Phone').fill('+1 (416) 555-0100');
  await page.getByLabel('Relationship (optional)').fill('Brother');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('✓ Saved.')).toBeVisible();
  const { rows } = await f.pool.query('select dietary_notes, emergency_name, emergency_phone, emergency_relation from participants where id = $1', [f.p.A]);
  expect(rows).toEqual([{ dietary_notes: 'Vegetarian', emergency_name: 'Sam Fixture', emergency_phone: '+1 (416) 555-0100', emergency_relation: 'Brother' }]);
  await a.close();

  // B taps A's badge: A's shared profile (on by default since v0.9), never A's menu.
  const b = await browser.newContext({ baseURL: E2E_ORIGIN });
  const bPage = await b.newPage();
  await createAccount(await emailOf(f.p.B));
  await signIn(bPage, await emailOf(f.p.B), `/profile/${uid}?tap`);
  await expect(bPage.getByRole('heading', { name: 'Ada Fixture' })).toBeVisible();
  // C is waitlisted: no menu, and its pages 404.
  await b.close();
  const c = await browser.newContext({ baseURL: E2E_ORIGIN });
  const cPage = await c.newPage();
  await createAccount(await emailOf(f.p.C));
  await signIn(cPage, await emailOf(f.p.C), '/me');
  await expect(cPage.getByRole('heading', { name: 'My events' })).toBeVisible();
  await expect(cPage.getByRole('navigation', { name: 'Hacker menu' })).toHaveCount(0);
  expect((await cPage.goto('/me/profile'))?.status()).toBe(404);
  await c.close();
});

test('T-ADM-08: the organizer sees the emergency contact on the participant detail', async ({ page }) => {
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}/participants`);
  await page.getByRole('button', { name: 'Details for Ada Fixture' }).click();
  await expect(page.getByText('Emergency contact')).toBeVisible();
  await expect(page.getByRole('link', { name: '+1 (416) 555-0100' })).toHaveAttribute('href', 'tel:+14165550100');
  await expect(page.getByText(/Sam Fixture \(Brother\)/)).toBeVisible();
});


test('T-ME-11: poster calendar keeps all events, overlap lanes and phone day controls', async ({ page }) => {
  const schedule = readFileSync(new URL('../fixtures/schedule/official.txt', import.meta.url), 'utf8');
  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}`);
  const saved = await page.request.patch(`/api/admin/${f.slug}/event`, { data: { schedule } });
  expect(saved.ok()).toBe(true);
  await signIn(page, await emailOf(f.p.A), '/me/schedule');
  await page.setViewportSize({ width: 1440, height: 900 });
  const saturday = page.getByRole('list', { name: 'Saturday, Nov 7', exact: true });
  const sunday = page.getByRole('list', { name: 'Sunday, Nov 8', exact: true });
  await expect(saturday.getByRole('listitem')).toHaveCount(23);
  await expect(sunday.getByRole('listitem')).toHaveCount(6);
  await expect(page.getByRole('heading', { name: 'SAT NOV 7' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SUN NOV 8' })).toBeVisible();
  await expect(saturday.getByText('Magic: The Gathering', { exact: true })).toBeVisible();
  await expect(sunday.getByText('Demos + Judging', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Event categories' }).getByRole('listitem')).toHaveCount(5);
  const workshop = saturday.getByRole('listitem').filter({ hasText: 'Workshop: Google' });
  await workshop.focus();
  await expect(workshop).toContainText('ADK, MCP & Cloud DBs');
  await expect(workshop).toContainText('2:30 PM to 3:30 PM · 5F');
  await expect(workshop).toContainText('Workshops');
  await page.setViewportSize({ width: 390, height: 844 });
  const satButton = page.getByRole('button', { name: 'Sat Nov 7', exact: true });
  const sunButton = page.getByRole('button', { name: 'Sun Nov 8', exact: true });
  await satButton.click();
  await expect(satButton).toHaveAttribute('aria-pressed', 'true');
  await expect(saturday).toBeVisible();
  await expect(sunday).toBeHidden();
  await sunButton.click();
  await expect(sunButton).toHaveAttribute('aria-pressed', 'true');
  await expect(sunday).toBeVisible();
  await expect(saturday).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await sunButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('T-ME-11: live event-time marker updates each minute and past events are grey', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-07T19:40:00Z') });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, await emailOf(f.p.A), '/me/schedule');
  const line = page.getByTestId('schedule-now');
  await expect(line).toContainText('now 2:40 PM');
  await expect(line).toHaveCSS('pointer-events', 'none');
  await expect(page.getByRole('button', { name: 'Sat Nov 7', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const saturday = page.getByRole('list', { name: 'Saturday, Nov 7', exact: true });
  const morning = saturday.getByRole('listitem').filter({ hasText: 'Check-in' });
  await expect(morning).toHaveAttribute('data-state', 'past');
  await expect(morning).toHaveCSS('background-color', 'rgb(34, 41, 54)');
  await expect(morning).toHaveCSS('color', 'rgb(143, 160, 196)');
  await expect(saturday.getByRole('listitem').filter({ hasText: 'Workshop: Google' })).toHaveAttribute('data-state', 'current');
  await page.clock.fastForward(60_000);
  await expect(line).toContainText('now 2:41 PM');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByText('Scroll across for overlapping events →')).toBeHidden();
});


test('T-ME-11: menu shows the official calendar immediately and Schedule scrolls to it', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-07T19:40:00Z') });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, await emailOf(f.p.A), '/me');
  const heading = page.getByRole('heading', { name: 'Schedule', exact: true });
  await expect(page.getByRole('heading', { name: 'SAT NOV 7' })).toBeVisible();
  await expect(page.getByTestId('schedule-now')).toContainText('now 2:40 PM');
  const saturday = page.getByRole('list', { name: 'Saturday, Nov 7', exact: true });
  await expect(saturday.getByRole('listitem')).toHaveCount(23);
  await expect(saturday.getByRole('listitem').filter({ hasText: 'Check-in' })).toHaveAttribute('data-state', 'past');
  await expect(page.getByRole('button', { name: 'Sat Nov 7', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const calendar = page.getByRole('region', { name: 'Sat Nov 7 calendar' });
  expect(await calendar.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'smooth');
  await page.getByRole('link', { name: 'Schedule', exact: true }).click();
  await expect(page).toHaveURL(/\/me#schedule$/);
  await expect(heading).toBeInViewport();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');
  await page.getByRole('button', { name: 'Sun Nov 8', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Sunday, Nov 8', exact: true }).getByRole('listitem')).toHaveCount(6);
  await expect(saturday).toBeHidden();
});
