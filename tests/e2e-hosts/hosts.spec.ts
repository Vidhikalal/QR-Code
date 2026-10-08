import { expect, test } from '@playwright/test';
import { latestMagicLink } from '../fixtures/mailpit';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';
import { ADMIN, ME } from '../../playwright.hosts.config';

// PLAN §5.1: two hostnames. Page navigations go through Chromium (which maps *.passline.test).
test.describe.configure({ mode: 'serial' });

let f: StandardFixture;
test.beforeAll(async () => {
  f = await createStandardFixture();
});
test.afterAll(async () => {
  await f.close();
});

test('T-HOST-02 (E): staff pages are 404 on the ME host; participant pages are 404 on the ADMIN host', async ({ page }) => {
  test.setTimeout(120_000); // first requests compile routes
  for (const [url, status] of [
    [`${ME}/login`, 404],
    [`${ME}/admin`, 404],
    [`${ADMIN}/me`, 404],
    [`${ADMIN}/edit`, 404],
    [`${ME}/me`, 200],
    [`${ADMIN}/login`, 200],
  ] as const) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(status);
  }
});

test('T-HOST-04 (cookie half): staff sign in on ADMIN; the session cookie is shared and authorizes a staff API on ME', async ({ page, context }) => {
  test.setTimeout(120_000);
  const email = f.staffEmail.org1;
  await page.goto(`${ADMIN}/login?next=/admin`);
  const started = Date.now();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email for a sign-in link')).toBeVisible();
  await page.goto(await latestMagicLink(email, started));
  await page.waitForURL(`${ADMIN}/admin`);

  const auth = (await context.cookies()).filter((c) => c.name.startsWith('sb-'));
  expect(auth.length).toBeGreaterThan(0);
  for (const c of auth) expect(c.domain, c.name).toBe('.passline.test');

  // A staff API that the badge page will use (I-23), called from a page on the ME host.
  await page.goto(`${ME}/me`);
  const result = await page.evaluate(async (id) => {
    const res = await fetch(`/api/participants/${id}/signin-code`, { method: 'POST' });
    return { status: res.status, body: (await res.json()) as { url?: string } };
  }, f.p.A);
  expect(result.status).toBe(200);
  expect(result.body.url).toMatch(new RegExp(`^${ME.replaceAll('.', '\\.')}/signin#`));
});
