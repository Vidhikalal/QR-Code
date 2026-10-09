import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authStatePath, chooseCheckpoint, E2E_ORIGIN, fakeCameraArgs, saveSignedInState, warmDevServer } from '../fixtures/e2e';
import { installFakeNfc, tap } from '../fixtures/nfc';
import { createStandardFixture, type Badges, type StandardFixture } from '../fixtures/standard';

// PLAN F20 (Android door): ADMIT → "Tap a blank badge" → linked, with undo, in-use and replace paths.
const AUTH = authStatePath('nfc-door');
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

async function named(first: string) {
  const n = await f.addParticipant(f.e1.id);
  const unique = `${first}${randomBytes(2).toString('hex')}`;
  await f.pool.query('update participants set first_name = $2, search_text = $3 where id = $1', [n.id, unique, `${unique.toLowerCase()} fixture`]);
  return { id: n.id, first: unique, name: `${unique} Fixture` };
}

async function admit(page: import('@playwright/test').Page, person: { first: string; name: string }) {
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill(person.first);
  await page.getByRole('button', { name: `Record scan for ${person.name}` }).click();
  await expect(page.getByTestId('scan-result')).toContainText('ADMIT');
}

const url = (publicId: string) => `${E2E_ORIGIN}/t/${publicId}`;

test('T-NFC-05: ADMIT → Tap a blank badge → "T4 linked to …" → Undo badge link', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Door');
  await page.getByRole('button', { name: 'Start NFC' }).click();
  await expect(page.getByTestId('nfc-state')).toContainText('NFC ready');
  const person = await named('Linkee');
  await admit(page, person);
  const prompt = page.getByTestId('badge-prompt');
  await expect(prompt).toContainText(`Tap a blank badge`);
  await expect(prompt).toContainText(person.name);

  await tap(page, b.tag.T4.uid, url(b.tag.T4.publicId));
  const result = page.getByTestId('scan-result');
  await expect(result).toHaveAttribute('data-tone', 'green');
  await expect(result).toContainText(`T4 linked to ${person.name}`);
  const linked = await f.pool.query('select 1 from tag_assignments where tag_id = $1 and participant_id = $2 and ended_at is null', [b.tag.T4.id, person.id]);
  expect(linked.rows).toHaveLength(1);
  await expect(prompt).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo badge link' }).click();
  await expect(page.getByText('Badge link undone')).toBeVisible();
  const after = await f.pool.query('select end_reason from tag_assignments where tag_id = $1 and participant_id = $2', [b.tag.T4.id, person.id]);
  expect(after.rows).toEqual([{ end_reason: 'unassigned' }]);
});

test('T-NFC-05: someone else’s badge is refused; if the person got a badge meanwhile, Replace it works', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Door');
  await page.getByRole('button', { name: 'Start NFC' }).click();
  const person = await named('Swapper');
  await admit(page, person);
  await expect(page.getByTestId('badge-prompt')).toBeVisible();

  await tap(page, b.tag.T1.uid, url(b.tag.T1.publicId)); // Ada's
  const result = page.getByTestId('scan-result');
  await expect(result).toHaveAttribute('data-tone', 'red');
  await expect(result).toContainText('Badge belongs to Ada Fixture');
  await result.click();

  // Another station linked T5 to them in the meantime.
  await f.pool.query('select assign_tag($1, $2, $3, $4, null, false)', [f.e1.id, f.staff.org1, person.id, b.tag.T5.publicId]);
  await tap(page, b.tag.T6.uid, url(b.tag.T6.publicId));
  const ask = page.getByRole('alertdialog', { name: `${person.name} already has T5` });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Replace it' }).click();
  await expect(page.getByTestId('scan-result')).toContainText(`T6 linked to ${person.name}`);
  const { rows } = await f.pool.query('select retire_reason from tags where id = $1', [b.tag.T5.id]);
  expect(rows).toEqual([{ retire_reason: 'replaced' }]);
});

test('PLAN §10.1: a badge read with no prompt open explains itself; a foreign tag is "Not a Passline badge"', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Door');
  await page.getByRole('button', { name: 'Start NFC' }).click();
  await tap(page, b.tag.T7.uid, url(b.tag.T7.publicId));
  await expect(page.getByTestId('scan-result')).toContainText('Badge scanning at checkpoints comes next');
  // Dismissing it offers manual search (the fallback until V5); close that and carry on.
  await page.getByTestId('scan-result').click();
  await page.getByRole('region', { name: 'Manual search' }).getByRole('button', { name: 'Close' }).click();
  await tap(page, `04${randomBytes(6).toString('hex').toUpperCase()}`, 'https://example.com/hello');
  await expect(page.getByTestId('scan-result')).toContainText('Not a Passline badge');
});
