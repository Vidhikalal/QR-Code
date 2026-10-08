import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { authStatePath, E2E_ORIGIN, saveSignedInState } from '../fixtures/e2e';
import { createStandardFixture, type Badges, type StandardFixture } from '../fixtures/standard';

// PLAN §8 (V4b): /t/<publicId> for a stranger, the owner and staff; assign, unlink and replace.
const ORG = authStatePath('badge-page-org');
test.describe.configure({ mode: 'serial' });

let f: StandardFixture;
let b: Badges;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  f = await createStandardFixture();
  b = await f.addBadges();
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
});
test.afterAll(async () => {
  await f.close();
});

async function named(first: string) {
  const n = await f.addParticipant(f.e1.id);
  const unique = `${first}${randomBytes(2).toString('hex')}`;
  await f.pool.query(`update participants set first_name = $2, search_text = $3 where id = $1`, [n.id, unique, `${unique.toLowerCase()} fixture`]);
  return { id: n.id, name: `${unique} Fixture` };
}

test('PLAN §8.2: a stranger sees the public profile and a sign-in prompt; an unknown badge is 404', async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(`/t/${b.tag.T1.publicId}`);
  await expect(page.getByRole('article', { name: /Profile of Ada F\./ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to connect' })).toBeVisible();
  await expect(page.getByLabel('Staff panel')).toHaveCount(0);
  await page.goto(`/t/${b.tag.T4.publicId}`);
  await expect(page.getByRole('heading', { name: 'This badge isn’t activated yet.' })).toBeVisible();
  const res = await page.goto('/t/AAAAAAAAAAAA');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Not a Passline badge' })).toBeVisible();
  await context.close();
});

test('PLAN §8.2: the owner sees their badge with Edit my profile', async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const key = generateSecret();
  await f.pool.query('select issue_profile_key($1, $2)', [f.p.A, sha256hex(key)]);
  await page.goto(`/edit#${key}`);
  await expect(page).toHaveURL(`${E2E_ORIGIN}/me`);
  await page.goto(`/t/${b.tag.T1.publicId}`);
  await expect(page.getByRole('heading', { name: 'Your badge' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit my profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to connect' })).toHaveCount(0);
  await context.close();
});

test('F20 (iPhone door): staff admit someone, open a blank badge, assign it from the suggestion, then unlink it', async ({ browser }) => {
  const person = await named('Assignee');
  expect((await f.scan({ cp: f.cp.D, staff: f.staff.org1, participantId: person.id })).code).toBe('ACCEPTED');
  const context = await browser.newContext({ storageState: ORG });
  const page = await context.newPage();
  await page.goto(`/t/${b.tag.T4.publicId}`);
  await page.getByRole('button', { name: new RegExp(`Assign to ${person.name} \\(admitted by you \\d+ s ago\\)`) }).click();
  await expect(page.getByRole('status')).toContainText(`T4 linked to ${person.name}`);
  const panel = page.getByLabel('Staff panel');
  await expect(panel).toContainText(person.name);
  await panel.getByRole('button', { name: 'Unlink badge' }).click();
  await expect(page.getByRole('heading', { name: 'T4 isn’t linked yet' })).toBeVisible();
  await context.close();
});

test('F23: replacing a lost badge from a new one; the old badge then shows as deactivated', async ({ browser }) => {
  const person = await named('Replacer');
  await f.pool.query('select assign_tag($1, $2, $3, $4, null, false)', [f.e1.id, f.staff.org1, person.id, b.tag.T5.publicId]);
  const context = await browser.newContext({ storageState: ORG });
  const page = await context.newPage();
  await page.goto(`/t/${b.tag.T6.publicId}`);
  await page.getByLabel('Find someone').fill(person.name.split(' ')[0] ?? '');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: `Assign to ${person.name}` }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Replace their badge?' });
  await expect(dialog).toContainText(`${person.name} already has T5`);
  await dialog.getByRole('button', { name: 'Replace it' }).click();
  await expect(page.getByRole('status')).toContainText(`T6 linked to ${person.name}`);
  await page.goto(`/t/${b.tag.T5.publicId}`);
  await expect(page.getByTestId('staff-retired')).toContainText(`Current badge: T6 (${person.name})`);
  await context.close();
});
