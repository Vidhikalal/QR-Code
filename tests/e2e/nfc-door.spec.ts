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
  await expect(prompt).toContainText(`Link a badge to ${person.name}`);
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

test('PLAN §10.1: a badge read with no prompt open is a Door scan; an unlinked one says so; a foreign tag is "Not a Passline badge"', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Door');
  await page.getByRole('button', { name: 'Start NFC' }).click();
  await tap(page, b.tag.T7.uid, url(b.tag.T7.publicId)); // registered, never linked
  const result = page.getByTestId('scan-result');
  await expect(result).toContainText('BADGE NOT LINKED (T7)');
  await expect(result).toContainText('Scan their pass first');
  await result.click();
  await tap(page, `04${randomBytes(6).toString('hex').toUpperCase()}`, 'https://example.com/hello');
  await expect(page.getByTestId('scan-result')).toContainText('Not a Passline badge');
});

// Real Android phones (user report, 2026-10-10): while the rear camera runs, NFC taps never arrive;
// they resume the moment it stops. So the camera must be off whenever a badge tap is expected.
test('Camera off while waiting for a badge: the Door prompt pauses the camera, and it resumes after', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Door');
  const main = page.locator('main');
  await expect(main).toHaveAttribute('data-camera', 'ready');
  await page.getByRole('button', { name: 'Start NFC' }).click();
  await expect(page.getByTestId('nfc-state')).toContainText('NFC ready');
  const person = await named('Paused');
  await admit(page, person);
  await expect(page.getByTestId('badge-prompt')).toBeVisible();
  await expect(main).toHaveAttribute('data-camera', 'off');
  await expect(page.locator('video')).toHaveJSProperty('srcObject', null);
  await tap(page, b.tag.T7.uid, url(b.tag.T7.publicId));
  await expect(page.getByTestId('scan-result')).toContainText(`T7 linked to ${person.name}`);
  await expect(main).toHaveAttribute('data-camera', 'ready');
});

test('NFC mode: the camera turns off, a badge tap checks in, Camera mode turns it back on', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Raffle');
  const main = page.locator('main');
  await expect(main).toHaveAttribute('data-camera', 'ready');
  await page.getByRole('button', { name: 'NFC', exact: true }).click();
  await expect(page.getByRole('button', { name: 'NFC', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(main).toHaveAttribute('data-camera', 'off');
  await expect(page.getByTestId('nfc-state')).toContainText('NFC ready');
  await expect(page.getByText(/camera is off/i)).toBeVisible();
  await tap(page, b.tag.T2.uid, url(b.tag.T2.publicId)); // B's badge; Raffle needs no check-in
  await expect(page.getByTestId('scan-result')).toHaveAttribute('data-tone', 'green');
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(main).toHaveAttribute('data-camera', 'ready');
});

test('Door, blank badge (user flow 2026-10-10): ADMIT → tap a blank badge → written, registered and linked, by a volunteer', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Door');
  await page.getByRole('button', { name: 'Start NFC' }).click();
  await expect(page.getByTestId('nfc-state')).toContainText('NFC ready');
  const person = await named('Blank');
  const reserved = page.waitForResponse((r) => r.url().includes('/api/tags/door-reserve'));
  await admit(page, person);
  await expect(page.getByTestId('badge-prompt')).toBeVisible();
  await reserved; // the id is ready before the badge touches the phone
  const serial = `04${randomBytes(6).toString('hex').toUpperCase()}`;
  await tap(page, serial, null); // a blank badge: serial only, no records
  const result = page.getByTestId('scan-result');
  await expect(result).toHaveAttribute('data-tone', 'green');
  await expect(result).toContainText(new RegExp(`B-\\d{4} linked to ${person.name}`));
  const { rows } = await f.pool.query<{ public_id: string }>(
    'select g.public_id from tags g join tag_assignments a on a.tag_id = g.id where g.uid = $1 and a.participant_id = $2 and a.ended_at is null',
    [serial, person.id],
  );
  expect(rows).toHaveLength(1);
  const writes = await page.evaluate(() => (window as unknown as { __nfc: { writes: string[] } }).__nfc.writes);
  expect(writes).toEqual([`${E2E_ORIGIN}/t/${rows[0]?.public_id}`]);
});

// Mandatory badges (user decision 2026-10-11): after ADMIT the badge step stays until a badge is
// linked; "No badge right now" needs a confirm; re-scanning the pass at the Door brings the step back.
test('Badge step is mandatory: no timeout, "No badge right now" asks first, a re-scan brings it back', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Door');
  await page.getByRole('button', { name: 'Start NFC' }).click();
  await expect(page.getByTestId('nfc-state')).toContainText('NFC ready');
  const person = await named('Must');
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill(person.first);
  const record = page.getByRole('button', { name: `Record scan for ${person.name}` });
  await expect(record).toBeVisible();
  await page.clock.install(); // timers from here on are fake: an old 30 s timeout would fire below
  await record.click();
  const result = page.getByTestId('scan-result');
  await expect(result).toContainText('ADMIT');
  await expect(result).toContainText('Next: link a badge');
  await expect(result).not.toContainText('Tap to skip');
  await page.clock.runFor(3_000);
  const step = page.getByTestId('badge-prompt');
  await expect(step).toContainText(`Link a badge to ${person.name}`);
  await page.clock.runFor(40_000);
  await expect(step).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'off');

  await step.getByRole('button', { name: 'No badge right now' }).click();
  const confirm = page.getByRole('dialog', { name: 'Continue without a badge?' });
  await expect(confirm).toContainText(`${person.name} can’t check in at meals or workshops until a badge is linked`);
  await confirm.getByRole('button', { name: 'Continue without a badge' }).click();
  await expect(step).toHaveCount(0);

  // Link later: scan their pass again at the Door.
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill(person.first);
  await page.getByRole('button', { name: `Record scan for ${person.name}` }).click();
  // "You scanned this … ago" (own recent scan) or "ALREADY SCANNED …": either way, it leads to the badge step.
  await expect(result).toContainText(/scanned/i);
  await expect(result).toContainText('Tap to link a badge');
  await result.click(); // a problem result needs a tap
  await expect(step).toContainText(`Link a badge to ${person.name}`);
  await page.clock.runFor(1_000);
  await tap(page, `04${randomBytes(6).toString('hex').toUpperCase()}`, null);
  await expect(page.getByTestId('scan-result')).toContainText(new RegExp(`B-\\d{4} linked to ${person.name}`));
});

test('Badge step offers Start NFC when NFC is off', async ({ page }) => {
  await installFakeNfc(page);
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Door');
  const person = await named('Late');
  await admit(page, person);
  const step = page.getByTestId('badge-prompt');
  await expect(step).toContainText(`Link a badge to ${person.name}`);
  await step.getByRole('button', { name: 'Start NFC' }).click();
  await expect(page.getByTestId('nfc-state')).toContainText('NFC ready');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'off');
  await tap(page, `04${randomBytes(6).toString('hex').toUpperCase()}`, null);
  await expect(page.getByTestId('scan-result')).toContainText(new RegExp(`B-\\d{4} linked to ${person.name}`));
});
