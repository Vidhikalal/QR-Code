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

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Profile saved' })).toBeVisible();
}

test('Demo feedback 2026-10-14: one Save for the whole profile; Year, dietary and top-3 skills are picked from lists', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const person = await f.addParticipant(f.e1.id);
  await signInParticipant(page, person.id);
  const card = page.getByRole('article', { name: /Profile of/ });
  await expect(card).toContainText('Extra F.');
  const patches: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().endsWith('/api/me/profile')) patches.push(r.postData() ?? '');
  });

  await page.getByLabel('Nickname').fill('Lace');
  await page.getByRole('textbox', { name: 'Bio' }).fill('Analytical engines.');
  await page.getByRole('combobox', { name: 'Year' }).selectOption('3rd year');
  await page.getByLabel('GitHub').fill('http://github.com/lace');
  await expect(page.getByText('✕ a github.com/… link starting with https://')).toBeVisible();
  await page.getByLabel('GitHub').fill('https://github.com/lace');

  // Skills are required: no skill, no save.
  await expect(page.getByText('✕ pick at least one skill')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  await page.getByLabel('Frontend').check();
  await page.getByLabel('AI / ML').check();
  await page.getByLabel('Other skill').fill('Rust, Go');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('3 of 3 picked')).toBeVisible();
  await expect(page.getByLabel('Backend')).toBeDisabled(); // a fourth pick is blocked
  await expect(page.getByLabel('Other skill')).toBeDisabled();

  await page.getByLabel('a team').check();
  await page.getByLabel('Vegan').check();
  await page.getByLabel('Nut allergy').check();
  await page.getByLabel('Other', { exact: true }).check();
  await page.getByLabel('Other dietary restriction').fill('no sesame');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await save(page);

  expect(patches).toHaveLength(1);
  expect(JSON.parse(patches[0] ?? '{}')).toMatchObject({ nickname: 'Lace', yearLabel: '3rd year', skills: ['Frontend', 'AI / ML', 'Rust, Go'], dietaryNotes: 'Vegan, Nut allergy, no sesame' });
  await expect(card.getByRole('heading', { name: 'Lace' })).toBeVisible();
  await expect(card).toContainText('3rd year');
  await expect(card).toContainText('Analytical engines.');
  await expect(card).toContainText('Rust, Go');
  // Health notes start organizers-only.
  await expect(card).not.toContainText('Vegan');
  await expect(page.getByRole('button', { name: 'Dietary restrictions: organizers only' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('row-dietaryNotes')).toContainText('Only organizers see this.');
  const { rows } = await f.pool.query('select dietary_notes from participants where id = $1', [person.id]);
  expect(rows[0]).toEqual({ dietary_notes: 'Vegan, Nut allergy, no sesame' });

  // After a reload the lists read the saved values back.
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Year' })).toHaveValue('3rd year');
  await expect(page.getByLabel('Nut allergy')).toBeChecked();
  await expect(page.getByLabel('Other dietary restriction')).toHaveValue('no sesame');
  await expect(page.getByText('All changes saved')).toBeVisible();

  await page.getByLabel(/Hide my whole profile/).check();
  await save(page);
  await expect(card).toContainText('This profile is private.');
  await context.close();
});

test('Profiles 2026-10-13: a field switched to organizers-only disappears from another participant\'s view of the badge', async ({ browser }) => {
  const b = await f.addBadges(); // A wears T1
  await f.pool.query(
    `insert into profiles (participant_id, bio, ask_me_about) values ($1, 'Engines and poems.', '{Research}')
     on conflict (participant_id) do update set bio = excluded.bio, ask_me_about = excluded.ask_me_about, public_fields = default, visibility = 'public'`,
    [f.p.A],
  );
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
  await expect(them.getByRole('article', { name: /Profile of/ })).toContainText('Engines and poems.'); // not saved yet
  await save(me);
  await them.reload();
  await expect(them.getByRole('article', { name: /Profile of/ })).not.toContainText('Engines and poems.');
  await me.getByRole('button', { name: 'Bio: organizers only' }).click();
  await save(me);
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
  await page.getByLabel('Other skill').fill('Sponsorships');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await save(page);
  await expect(preview).toContainText('Sponsorships');
  await context.close();
});
