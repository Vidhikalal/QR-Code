import { expect, test, type Page } from '@playwright/test';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { authStatePath, E2E_ORIGIN, saveSignedInState } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN §10.4 / F15 (V3): the /me profile editor, the public preview, and the organizer's badge profile.
const ORG = authStatePath('profile-org');
test.describe.configure({ mode: 'serial' });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
});
test.afterAll(async () => {
  await f.close();
});

async function signInParticipant(page: Page, participantId: string) {
  const key = generateSecret();
  await f.pool.query('select issue_profile_key($1, $2)', [participantId, sha256hex(key)]);
  await page.goto(`/edit#${key}`);
  await expect(page).toHaveURL(`${E2E_ORIGIN}/me`);
}

test('PLAN §10.4: a participant edits their profile and the public preview updates', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const person = await f.addParticipant(f.e1.id);
  await signInParticipant(page, person.id);
  const preview = page.getByRole('article', { name: /Profile of/ });
  await expect(preview).toContainText('Extra F.');
  await page.getByLabel('Nickname').fill('Lace');
  await page.getByLabel('Bio').fill('Analytical engines.');
  await page.getByLabel('GitHub').fill('http://github.com/lace');
  await expect(page.getByText('✕ a github.com/… link starting with https://')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  await page.getByLabel('GitHub').fill('https://github.com/lace');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect(preview).toContainText('Lace');
  await expect(preview.getByRole('link', { name: 'GitHub' })).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
  await page.getByLabel(/Hidden: only your name/).check();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(preview).toContainText('Hidden: others only see your name.');
  await expect(preview).not.toContainText('Analytical engines.');
  await context.close();
});

test('T-SEC2-05: profile fields with HTML render as text on /me and in the admin drawer', async ({ browser }) => {
  const person = await f.addParticipant(f.e1.id);
  // A unique name, so the admin list row is unambiguous (other tests here also add "Extra Fixture").
  await f.pool.query(`update participants set first_name = 'Xenia', search_text = 'xenia fixture' where id = $1`, [person.id]);
  await f.pool.query(
    `insert into profiles (participant_id, nickname, bio) values ($1, $2, $3)
     on conflict (participant_id) do update set nickname = excluded.nickname, bio = excluded.bio`,
    [person.id, '<img src=x onerror=alert(1)>', '"><script>window.__xss=1</script>'],
  );
  const dialogs: string[] = [];
  const check = async (page: Page) => {
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await expect(page.getByText('<img src=x onerror=alert(1)>').first()).toBeVisible();
    await expect(page.getByText('"><script>window.__xss=1</script>').first()).toBeVisible();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  };

  const participant = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const p = await participant.newPage();
  await signInParticipant(p, person.id);
  await check(p);
  await participant.close();

  const staff = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: ORG });
  const s = await staff.newPage();
  await s.goto(`/admin/${f.slug}/participants`);
  await s.getByRole('row', { name: /Xenia Fixture/ }).getByRole('button', { name: 'Details for Xenia Fixture' }).click();
  await check(s);
  await s.getByRole('button', { name: 'Hide profile' }).click();
  await expect(s.getByText('Hidden by an organizer.')).toBeVisible();
  await staff.close();
  expect(dialogs).toEqual([]);
});

test('F15: an organizer opens My badge profile, lands on /me labelled Organizer, and adds a topic', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: ORG });
  const page = await context.newPage();
  await page.goto(`/admin/${f.slug}`);
  await page.getByRole('button', { name: 'My badge profile' }).click();
  await expect(page).toHaveURL(`${E2E_ORIGIN}/me`);
  const preview = page.getByRole('article', { name: /Profile of/ });
  await expect(preview).toContainText('Organizer');
  await page.getByLabel('New topic').fill('Sponsorships');
  await page.getByRole('button', { name: 'Add topic' }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(preview.getByRole('listitem').filter({ hasText: 'Sponsorships' })).toBeVisible();
  await context.close();
});
