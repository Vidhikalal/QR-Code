import { expect, test } from '@playwright/test';
import { consoleMailText, E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { generateToken, sha256hex } from '@/lib/domain/token';
import { createAccount, createStandardFixture, STAFF_PASSWORD, type StandardFixture } from '../fixtures/standard';

// SPEC F13 + §6.1 (v0.4): organizer sends an RSVP → Yes (emergency contact, v0.6) + password → /me shows the pass.
let f: StandardFixture;
test.beforeEach(async () => {
  f = await createStandardFixture();
});
test.afterEach(async () => {
  await f.close();
});

test('T-RSVP-05: tick → Send RSVP → Yes with an emergency contact and a password → /me → the same pass as the email; tokens never in a URL', async ({ browser, page }) => {
  const email = `rae-${f.slug}@example.test`;
  await f.pool.query(
    `insert into participants (event_id, external_id, email, first_name, last_name, search_text, status, source)
     values ($1, 'rsvp-1', $2, 'Rae', 'Rsvp', 'rae rsvp', 'pending', 'sheet')`,
    [f.e1.id, email],
  );

  await signIn(page, f.staffEmail.org1, `/admin/${f.slug}/participants`);
  await page.getByLabel('Select Rae Rsvp').check();
  await page.getByRole('button', { name: 'Send RSVP (1)' }).click();
  await expect(page.getByRole('status')).toHaveText('✓ RSVP emails queued for 1 person.');
  // The email goes out after the response; the list marks the row once it has been sent.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText('RSVP sent')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  const rsvpToken = /\/rsvp#([A-Za-z0-9_-]{32})/.exec(await consoleMailText(email, '/rsvp#'))?.[1] ?? '';
  expect(rsvpToken).toHaveLength(32);

  const attendee = await browser.newContext({ baseURL: E2E_ORIGIN });
  const p = await attendee.newPage();
  const urls: string[] = [];
  p.on('request', (r) => urls.push(r.url()));
  await p.goto(`/rsvp#${rsvpToken}`);
  await expect(p.getByRole('heading', { name: f.e1.name })).toBeVisible();
  await expect(p.getByText('Hi Rae, will you be there?')).toBeVisible();
  await p.getByRole('button', { name: 'Yes, I’ll be there' }).click();
  await p.getByLabel('Emergency contact name').fill('Sam Rsvp');
  await p.getByLabel('Emergency contact phone').fill('416 555 0100');
  await p.getByLabel("I'm looking for a team: list me in the teammate directory (name only)").check();
  await p.getByLabel('Set a password for your Passline account').fill('rae-event-password');
  await p.getByRole('button', { name: 'Yes, I’ll be there' }).click();
  await p.waitForURL('**/me');
  await expect(p.getByRole('navigation', { name: 'Hacker menu' })).toBeVisible();
  const { rows } = await f.pool.query('select emergency_name, emergency_phone, looking_for_team from participants where email = $1', [email]);
  expect(rows).toEqual([{ emergency_name: 'Sam Rsvp', emergency_phone: '416 555 0100', looking_for_team: true }]);

  // The pass email is sent after the response; /me shows the pass once it's issued.
  const passToken = /\/p#([A-Za-z0-9_-]{32})/.exec(await consoleMailText(email, '/p#'))?.[1] ?? '';
  await expect(async () => {
    await p.reload();
    await expect(p.getByRole('link', { name: 'My pass' })).toHaveAttribute('href', `/p#${passToken}`, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await p.getByRole('link', { name: 'My pass' }).click();
  await expect(p.getByRole('img', { name: 'Your check-in QR code' })).toBeVisible();
  expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: passToken })).code).toBe('ACCEPTED');

  // I-3: neither token ever went into a URL the server saw.
  expect(urls.filter((u) => u.includes(rsvpToken) || u.includes(passToken))).toEqual([]);

  // T-ME-01 (E): signed out, /me goes to sign-in; signing in with the new password comes back.
  await attendee.clearCookies();
  await p.goto('/me');
  await expect(p).toHaveURL(/\/login\?next=%2Fme/);
  await signIn(p, email, '/me', 'rae-event-password');
  await expect(p.getByRole('link', { name: 'My pass' })).toBeVisible();
  await attendee.close();
});

test('T-RSVP-04 (E): someone who already has an account types their own password on Yes; a wrong one is refused', async ({ browser }) => {
  const email = `ari-${f.slug}@example.test`;
  await createAccount(email);
  const token = generateToken();
  await f.pool.query(
    `insert into participants (event_id, external_id, email, first_name, last_name, search_text, status, source, rsvp_token_hash)
     values ($1, 'rsvp-acct', $2, 'Ari', 'Account', 'ari account', 'pending', 'sheet', $3)`,
    [f.e1.id, email, sha256hex(token)],
  );
  const attendee = await browser.newContext({ baseURL: E2E_ORIGIN });
  const p = await attendee.newPage();
  await p.goto(`/rsvp#${token}`);
  await p.getByRole('button', { name: 'Yes, I’ll be there' }).click();
  await expect(p.getByLabel('Set a password for your Passline account')).toHaveCount(0);
  await p.getByLabel('Emergency contact name').fill('Sam Account');
  await p.getByLabel('Emergency contact phone').fill('416 555 0100');
  await p.getByLabel('Your Passline password').fill('not-my-password');
  await p.getByRole('button', { name: 'Yes, I’ll be there' }).click();
  // Next's route announcer is also role=alert (empty), so pick ours by its text.
  await expect(p.getByRole('alert').filter({ hasText: 'isn’t your Passline password' })).toBeVisible();
  expect((await f.pool.query('select status from participants where email = $1', [email])).rows).toEqual([{ status: 'pending' }]);
  await p.getByLabel('Your Passline password').fill(STAFF_PASSWORD);
  await p.getByRole('button', { name: 'Yes, I’ll be there' }).click();
  await p.waitForURL('**/me');
  await expect(p.getByRole('navigation', { name: 'Hacker menu' })).toBeVisible();
  await attendee.close();
});

test('T-RSVP-04 (E): a volunteer without a display name who answers Yes goes through onboarding first (F9)', async ({ browser }) => {
  const email = `vic-${f.slug}@example.test`;
  const userId = await createAccount(email);
  await f.pool.query(`insert into event_staff (event_id, user_id, role) values ($1, $2, 'volunteer')`, [f.e1.id, userId]);
  const token = generateToken();
  await f.pool.query(
    `insert into participants (event_id, external_id, email, first_name, last_name, search_text, status, source, rsvp_token_hash)
     values ($1, 'rsvp-staff', $2, 'Vic', 'Volunteer', 'vic volunteer', 'pending', 'sheet', $3)`,
    [f.e1.id, email, sha256hex(token)],
  );
  const attendee = await browser.newContext({ baseURL: E2E_ORIGIN });
  const p = await attendee.newPage();
  await p.goto(`/rsvp#${token}`);
  await p.getByRole('button', { name: 'Yes, I’ll be there' }).click();
  await p.getByLabel('Emergency contact name').fill('Sam Volunteer');
  await p.getByLabel('Emergency contact phone').fill('416 555 0100');
  await p.getByLabel('Your Passline password').fill(STAFF_PASSWORD);
  await p.getByRole('button', { name: 'Yes, I’ll be there' }).click();
  await p.waitForURL((u) => u.pathname === '/onboarding' && u.searchParams.get('next') === '/me');
  await attendee.close();
});
