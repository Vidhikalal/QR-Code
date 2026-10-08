import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// PLAN §5.1 / T-HOST-*: the app with two hostnames, as in production. Chromium resolves *.passline.test
// to this machine; the dev server is told the ME and ADMIN origins and the shared cookie domain.
// Runs after the main e2e config (`pnpm test:e2e`): `next dev` can't run twice in one folder at once.
if (existsSync('.env.test')) process.loadEnvFile('.env.test');

const port = 3101;
export const ME = `http://me.passline.test:${port}`;
export const ADMIN = `http://admin.passline.test:${port}`;

export default defineConfig({
  testDir: 'tests/e2e-hosts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: ADMIN,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--host-resolver-rules=MAP *.passline.test 127.0.0.1'] },
  },
  webServer: {
    command: `mkdir -p .e2e && pnpm dev --port ${port} 2>&1 | tee .e2e/server-hosts.log`,
    url: `http://127.0.0.1:${port}/login`, // 127.0.0.1 is neither host, so nothing is filtered
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_APP_ORIGIN: ME,
      NEXT_PUBLIC_ADMIN_ORIGIN: ADMIN,
      NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: '.passline.test',
    },
  },
});
