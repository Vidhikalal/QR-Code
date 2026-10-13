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

async function editRow(page: Page, label: string, fill: (page: Page) => Promise<void>) {
  await page.getByRole('button', { name: `Edit ${label}` }).click();
  await fill(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: `${label} saved` })).toBeVisible();
}

test('Profiles 2026-10-13: edit directly on the "How others see you" card, with validation', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const person = await f.addParticipant(f.e1.id);
  await signInParticipant(page, person.id);
  const card = page.getByRole('article', { name: /Profile of/ });
  await expect(card).toContainText('Extra F.');
  await editRow(page, 'Nickname', (p) => p.getByLabel('Nickname').fill('Lace'));
  await expect(card.getByRole('heading', { name: 'Lace' })).toBeVisible();
  await editRow(page, 'Bio', (p) => p.getByLabel('Bio').fill('Analytical engines.'));
  await expect(page.getByTestId('row-bio')).toContainText('Analytical engines.');

  await page.getByRole('button', { name: 'Edit Links' }).click();
  await page.getByLabel('GitHub').fill('http://github.com/lace');
  await expect(page.getByText('✕ a github.com/… link starting with https://')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.getByLabel('GitHub').fill('https://github.com/lace');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Links saved' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Links' })).toContainText('GitHub');

  await editRow(page, 'What I’m good at', async (p) => {
    await p.getByLabel('New skill').fill('Rust');
    await p.getByRole('button', { name: 'Add skill' }).click();
  });
  await expect(page.getByTestId('row-skills')).toContainText('Rust');
  await editRow(page, 'Looking for', (p) => p.getByLabel('a team').check());
  await expect(page.getByTestId('row-lookingFor')).toContainText('a team');

  // Health notes start organizers-only.
  await editRow(page, 'Dietary restrictions', (p) => p.getByLabel('Dietary restrictions').fill('Vegan'));
  await expect(page.getByRole('button', { name: 'Dietary restrictions: organizers only' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('row-dietaryNotes')).toContainText('Only organizers see this.');

  await page.getByLabel(/Hide my whole profile/).check();
  await expect(card).toContainText('Hidden: others only see your name.');
  await context.close();
});

test('Profiles 2026-10-13: a field switched to organizers-only disappears from another participant\'s view of the badge', async ({ browser }) => {
  const b = await f.addBadges(); // A wears T1
  await f.pool.query(`insert into profiles (participant_id, bio) values ($1, 'Engines and poems.') on conflict (participant_id) do update set bio = excluded.bio, public_fields = default, visibility = 'public'`, [f.p.A]);
  const owner = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const me = await owner.newPage();
  await signInParticipant(me, f.p.A);
  const other = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const them = await other.newPage();
  await signInParticipant(them, f.p.B);
  await them.goto(`/t/${b.tag.T1.publicId}`);
  await expect(them.getByRole('article', { name: /Profile of/ })).toContainText('Engines and poems.');

  await me.getByRole('button', { name: 'Bio: visible to participants' }).click();
  await expect(me.getByRole('button', { name: 'Bio: organizers only' })).toHaveAttribute('aria-pressed', 'false');
  await them.reload();
  await expect(them.getByRole('article', { name: /Profile of/ })).not.toContainText('Engines and poems.');
  await me.getByRole('button', { name: 'Bio: organizers only' }).click();
  await expect(me.getByRole('button', { name: 'Bio: visible to participants' })).toBeVisible();
  await them.reload();
  await expect(them.getByRole('article', { name: /Profile of/ })).toContainText('Engines and poems.');
  await owner.close();
  await other.close();
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

test('F15: an organizer opens My badge profile, lands on /me labelled Organizer, and adds a skill', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: ORG });
  const page = await context.newPage();
  await page.goto(`/admin/${f.slug}`);
  await page.getByRole('button', { name: 'My badge profile' }).click();
  await expect(page).toHaveURL(`${E2E_ORIGIN}/me`);
  const preview = page.getByRole('article', { name: /Profile of/ });
  await expect(preview).toContainText('Organizer');
  await editRow(page, 'What I’m good at', async (p) => {
    await p.getByLabel('New skill').fill('Sponsorships');
    await p.getByRole('button', { name: 'Add skill' }).click();
  });
  await expect(preview.getByTestId('row-skills')).toContainText('Sponsorships');
  await context.close();
});
