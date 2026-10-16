import { expect, test } from '@playwright/test';
import { E2E_ORIGIN, signInViaMagicLink } from '../fixtures/e2e';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §6.5 / §14.15: the public badge profile and the pass-page opt-in.
let f: StandardFixture;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  f = await createStandardFixture();
});
test.afterAll(async () => {
  await f.close();
});

const LINKEDIN = 'https://www.linkedin.com/in/ada-fixture';
const emailOf = async (participantId: string) =>
  (await f.pool.query<{ email: string }>('select email from participants where id = $1', [participantId])).rows[0]?.email ?? '';

test('T-NFC-14: a signed-out tap goes to sign-in and back; attendees of the event see the profile, others do not', async ({ browser, request }) => {
  const { uid } = await f.linkBadge(f.p.A);
  const tapPath = `/profile/${uid}?tap`;

  // Signed out: no profile data, just a redirect that remembers the way back.
  const out = await request.get(tapPath, { maxRedirects: 0 });
  expect(out.status()).toBe(307);
  const to = new URL(out.headers()['location'] ?? '', E2E_ORIGIN);
  expect(to.pathname).toBe('/login');
  // Next normalizes the bare `?tap` to `?tap=` when rebuilding the path; the page ignores it either way.
  expect(to.searchParams.get('next')).toMatch(new RegExp(`^/profile/${uid}\\?tap=?$`));

  // B attends the same event: sign in by magic link, land back on the badge.
  const b = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await b.newPage();
  await page.goto(tapPath);
  await expect(page.getByRole('heading', { name: 'Sign in to see this badge' })).toBeVisible();
  await signInViaMagicLink(page, await emailOf(f.p.B), tapPath);
  await expect(page.getByRole('heading', { name: /hasn’t shared a profile/ })).toBeVisible();

  await f.pool.query('update participants set profile_public = true, linkedin_url = $2 where id = $1', [f.p.A, LINKEDIN]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ada Fixture' })).toBeVisible();
  await expect(page.getByRole('link', { name: /LinkedIn/ })).toHaveAttribute('href', LINKEDIN);
  const html = await (await page.request.get(`/profile/${uid}`)).text();
  expect(html).not.toContain(await emailOf(f.p.A));
  expect(html).not.toContain('Vegetarian');

  // Opting out takes effect on the very next view (the page is never cached).
  await f.pool.query('update participants set profile_public = false where id = $1', [f.p.A]);
  await page.reload();
  await expect(page.getByRole('heading', { name: /hasn’t shared a profile/ })).toBeVisible();

  await page.goto(`/profile/${randomUid()}?tap`);
  await expect(page.getByRole('heading', { name: /isn’t linked yet/ })).toBeVisible();
  expect((await page.goto('/profile/not-a-uid'))?.status()).toBe(404);
  await b.close();

  // X is accepted at the other event: signed in, but not allowed to see this badge.
  const x = await browser.newContext({ baseURL: E2E_ORIGIN });
  const xPage = await x.newPage();
  await signInViaMagicLink(xPage, await emailOf(f.p.X), tapPath);
  await expect(xPage.getByRole('heading', { name: /Only people at this event/ })).toBeVisible();
  await expect(xPage.getByText('Ada')).toHaveCount(0);
  await x.close();
});

test('T-NFC-14: the pass-page opt-in sends the token only in a PATCH body', async ({ page }) => {
  const seen: Array<{ url: string; method: string; body: string | null }> = [];
  page.on('request', (r) => seen.push({ url: r.url(), method: r.method(), body: r.postData() }));
  await page.goto(`/p#${f.token.B}`);
  const box = page.getByRole('checkbox', { name: /show my name/i });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(page.getByText('✓ Your badge profile is shared.')).toBeVisible();
  await expect(box).toBeChecked();
  const { rows } = await f.pool.query('select profile_public from participants where id = $1', [f.p.B]);
  expect(rows).toEqual([{ profile_public: true }]);

  expect(seen.filter((r) => r.url.includes(f.token.B))).toEqual([]);
  const patch = seen.find((r) => r.method === 'PATCH');
  expect(patch && new URL(patch.url).pathname).toBe('/api/pass');
  expect(JSON.parse(patch?.body ?? '{}')).toEqual({ token: f.token.B, profilePublic: true });
});
