import { expect, test } from '@playwright/test';

test('home page sends signed-out visitors to sign-in (S0 smoke)', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL('/login?next=%2Fme');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
});
