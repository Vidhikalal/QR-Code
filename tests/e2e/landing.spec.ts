import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('the landing page offers staff sign-in and the attendee way back in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Passline', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Fadmin');
  await expect(page.getByRole('link', { name: 'Get a new link' })).toHaveAttribute('href', '/signin');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
});
