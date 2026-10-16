import { expect, test } from '@playwright/test';
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

test('T-NFC-14: /profile/<uid>?tap shows each state with no redirect and no private details', async ({ page, request }) => {
  const loose = randomUid();
  const res = await request.get(`/profile/${loose}?tap`, { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  await page.goto(`/profile/${loose}?tap`);
  await expect(page.getByRole('heading', { name: /isn’t linked yet/ })).toBeVisible();

  const { uid } = await f.linkBadge(f.p.A);
  await page.goto(`/profile/${uid}?tap`);
  await expect(page.getByRole('heading', { name: /hasn’t shared a profile/ })).toBeVisible();
  expect(new URL(page.url()).search).toBe('?tap');

  await f.pool.query('update participants set profile_public = true, linkedin_url = $2 where id = $1', [
    f.p.A,
    'https://www.linkedin.com/in/ada-fixture',
  ]);
  await page.goto(`/profile/${uid}?tap`);
  await expect(page.getByRole('heading', { name: 'Ada Fixture' })).toBeVisible();
  await expect(page.getByRole('link', { name: /LinkedIn/ })).toHaveAttribute('href', 'https://www.linkedin.com/in/ada-fixture');
  const html = await (await request.get(`/profile/${uid}`)).text();
  const { rows } = await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.A]);
  expect(rows[0]?.email).toBeTruthy();
  expect(html).not.toContain(rows[0]?.email ?? '');
  expect(html).not.toContain('Vegetarian');

  // Opting out takes effect on the very next view (the page is never cached).
  await f.pool.query('update participants set profile_public = false where id = $1', [f.p.A]);
  await page.goto(`/profile/${uid}`);
  await expect(page.getByRole('heading', { name: /hasn’t shared a profile/ })).toBeVisible();

  expect((await request.get('/profile/not-a-uid')).status()).toBe(404);
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
