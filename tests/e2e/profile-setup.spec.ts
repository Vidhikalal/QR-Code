import { expect, test, type Page } from '@playwright/test';
import { E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F14 step 3: /me/profile has two cards, profile setup (Save profile) and networking (Save links).
// Saving one never clears what was typed, and not yet saved, in the other.
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

async function openProfile(page: Page, participantId: string) {
  await createAccount(await emailOf(participantId));
  await signIn(page, await emailOf(participantId), '/me/profile');
  await expect(page.getByRole('heading', { name: 'Finish setting up your profile' })).toBeVisible();
}

const setup = (page: Page) => page.getByRole('region', { name: 'Profile setup' });
const networking = (page: Page) => page.getByRole('region', { name: 'Networking' });

test('T-ME-11: saving one card keeps what was typed in the other; a refused save keeps both; a reload shows only what was saved', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await ctx.newPage();
  await openProfile(page, f.p.A);

  // Setup typed but not saved; then the links are saved.
  await setup(page).getByLabel('Emergency contact name').fill('Sam Fixture');
  await setup(page).getByLabel('Emergency contact phone').fill('416 555 0100');
  await setup(page).getByRole('radio', { name: 'Yes', exact: true }).check();
  await setup(page).getByRole('radio', { name: 'I plan to go solo' }).check();
  await setup(page).getByLabel('Accessibility needs (optional)').fill('Step-free entrance');
  await networking(page).getByLabel('LinkedIn (optional)').fill('linkedin.com/in/ada-setup');
  await networking(page).getByRole('button', { name: 'Save links' }).click();
  await expect(networking(page).getByText('✓ Saved.')).toBeVisible();
  // The saved card shows what was stored (normalized); the other keeps the unsaved answers.
  await expect(networking(page).getByLabel('LinkedIn (optional)')).toHaveValue('https://www.linkedin.com/in/ada-setup');
  await expect(setup(page).getByLabel('Emergency contact name')).toHaveValue('Sam Fixture');
  await expect(setup(page).getByLabel('Emergency contact phone')).toHaveValue('416 555 0100');
  await expect(setup(page).getByRole('radio', { name: 'Yes', exact: true })).toBeChecked();
  await expect(setup(page).getByRole('radio', { name: 'I plan to go solo' })).toBeChecked();
  await expect(setup(page).getByLabel('Accessibility needs (optional)')).toHaveValue('Step-free entrance');
  await expect(page).toHaveURL(/\/me\/profile$/); // no reload into ?saved=

  // The other way round: links typed but not saved; then the setup is saved.
  await networking(page).getByLabel('Discord username (optional)').fill('ada.codes');
  await setup(page).getByRole('button', { name: 'Save profile' }).click();
  await expect(setup(page).getByText('✓ Saved. Your profile is set up.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hacker profile' })).toBeVisible();
  await expect(networking(page).getByLabel('Discord username (optional)')).toHaveValue('ada.codes');
  await expect(setup(page).getByLabel('Emergency contact name')).toHaveValue('Sam Fixture');

  // A save the server refuses keeps both cards as typed (the browser check is bypassed to reach the server).
  await setup(page).getByLabel('Emergency contact name').fill('Sam Changed');
  await networking(page).getByLabel('Website (optional)').fill('ada'); // no dot: refused
  await networking(page).locator('form').evaluate((form) => ((form as HTMLFormElement).noValidate = true));
  await networking(page).getByRole('button', { name: 'Save links' }).click();
  await expect(networking(page).getByRole('alert')).toContainText('Not saved');
  await expect(networking(page).getByLabel('Website (optional)')).toHaveValue('ada');
  await expect(networking(page).getByLabel('Discord username (optional)')).toHaveValue('ada.codes');
  await expect(setup(page).getByLabel('Emergency contact name')).toHaveValue('Sam Changed');

  // Unsaved edits are only on screen: a reload shows what was stored.
  await page.reload();
  await expect(setup(page).getByLabel('Emergency contact name')).toHaveValue('Sam Fixture');
  await expect(networking(page).getByLabel('Discord username (optional)')).toHaveValue('');
  await expect(networking(page).getByLabel('LinkedIn (optional)')).toHaveValue('https://www.linkedin.com/in/ada-setup');
  await ctx.close();
});

test('T-ME-12: the allergy toggle shows the allergy and its severity, both required; switching it off clears the stored allergy', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await ctx.newPage();
  await openProfile(page, f.p.B);
  const card = setup(page);
  await card.getByLabel('Emergency contact name').fill('Kim Fixture');
  await card.getByLabel('Emergency contact phone').fill('416 555 0101');
  await card.getByRole('radio', { name: 'No', exact: true }).check();
  await card.getByRole('radio', { name: 'I have a team' }).check();

  const toggle = card.getByRole('switch', { name: 'I have allergies' });
  await expect(toggle).not.toBeChecked();
  await expect(card.getByLabel('What are you allergic to?')).toHaveCount(0);
  await expect(card.getByLabel('How severe?')).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toBeChecked();
  const what = card.getByLabel('What are you allergic to?');
  const severity = card.getByLabel('How severe?');
  // Both required while the toggle is on: the browser refuses an empty one.
  await card.getByRole('button', { name: 'Save profile' }).click();
  expect(await what.evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await what.fill('Peanuts');
  await card.getByRole('button', { name: 'Save profile' }).click();
  expect(await severity.evaluate((el) => (el as HTMLSelectElement).validity.valueMissing)).toBe(true);
  await severity.selectOption('severe');
  await card.getByRole('button', { name: 'Save profile' }).click();
  await expect(card.getByText('✓ Saved. Your profile is set up.')).toBeVisible();
  const stored = async () =>
    (await f.pool.query<{ allergies: string | null; allergy_severity: string | null }>('select allergies, allergy_severity from participants where id = $1', [f.p.B])).rows[0];
  expect(await stored()).toEqual({ allergies: 'Peanuts', allergy_severity: 'severe' });

  // A stored allergy opens with the toggle on.
  await page.reload();
  await expect(setup(page).getByRole('switch', { name: 'I have allergies' })).toBeChecked();
  await expect(setup(page).getByLabel('What are you allergic to?')).toHaveValue('Peanuts');

  // Off hides both and saving clears them.
  await setup(page).getByRole('switch', { name: 'I have allergies' }).click();
  await expect(setup(page).getByLabel('What are you allergic to?')).toHaveCount(0);
  await setup(page).getByRole('button', { name: 'Save profile' }).click();
  await expect(setup(page).getByText('✓ Saved. Your profile is set up.')).toBeVisible();
  expect(await stored()).toEqual({ allergies: null, allergy_severity: null });
  await ctx.close();
});
