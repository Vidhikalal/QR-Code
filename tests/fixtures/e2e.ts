import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Browser, type Page } from '@playwright/test';
import { formatUid } from '@/lib/domain/badge';
import { latestMagicLink } from './mailpit';

export const E2E_ORIGIN = 'http://localhost:3100';

export function authStatePath(name: string): string {
  const dir = join(process.cwd(), 'tests', 'e2e', '.auth');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.json`);
}

// The real staff sign-in: login page → magic link from Mailpit → callback → `next`.
export async function signInViaMagicLink(page: Page, email: string, next: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  const started = Date.now();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email for a sign-in link')).toBeVisible();
  await page.goto(await latestMagicLink(email, started));
  await page.waitForURL((url) => url.pathname + url.search === next);
}

// Signs in once per spec file and saves cookies for `test.use({ storageState })`.
export async function saveSignedInState(browser: Browser, email: string, file: string): Promise<void> {
  // Explicit empty state: the runner would otherwise apply the file's (not yet written) storageState.
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signInViaMagicLink(page, email, '/');
  await context.storageState({ path: file });
  await context.close();
}

export const fakeCameraArgs = (videoFile?: string) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  ...(videoFile ? [`--use-file-for-fake-video-capture=${videoFile}`] : []),
];

// Web NFC fake (CLAUDE.md mock list): a `window.NDEFReader` that tests drive with `nfcTap`. Every
// started reader receives each tap; `write()` calls are recorded in `window.__nfcWrites`.
export async function installFakeNfc(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const readers = new Set<EventTarget>();
    const writes: unknown[] = [];
    class FakeNDEFReader extends EventTarget {
      async scan(options: { signal?: AbortSignal } = {}): Promise<void> {
        readers.add(this);
        options.signal?.addEventListener('abort', () => readers.delete(this));
      }
      async write(message: unknown): Promise<void> {
        writes.push(message);
      }
    }
    w.NDEFReader = FakeNDEFReader;
    w.__nfcWrites = writes;
    w.__nfcTap = (serialNumber: string, urls: string[]) => {
      const records = urls.map((u) => ({ recordType: 'url', data: new DataView(new TextEncoder().encode(u).buffer) }));
      for (const r of readers) r.dispatchEvent(Object.assign(new Event('reading'), { serialNumber, message: { records } }));
    };
  });
}

type NfcWindow = { __nfcTap(serial: string, urls: string[]): void; __nfcWrites: unknown[] };

export async function nfcTap(page: Page, serial: string, urls: string[] = []): Promise<void> {
  await page.evaluate(([s, u]) => (window as unknown as NfcWindow).__nfcTap(s, u), [serial, urls] as const);
}

export async function nfcWrites(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as unknown as NfcWindow).__nfcWrites);
}

/** Chrome's serial-number format for a stored UID: "04a1b2c3" → "04:A1:B2:C3". */
export const serialOf = formatUid;

export async function chooseCheckpoint(page: Page, name: string): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^\\S*\\s*${name}\\b`) }).click();
  await expect(page.getByTestId('checkpoint-banner')).toContainText(name);
}

// `next dev` compiles each route on its first request (seconds). Timing assertions are about the
// scanner, not the dev compiler, so hit the routes once first. Production has no such step.
export async function warmDevServer(slug: string): Promise<void> {
  await Promise.all([
    fetch(`${E2E_ORIGIN}/api/scan`, { method: 'POST', body: '{}' }),
    fetch(`${E2E_ORIGIN}/api/events/${slug}/checkpoints`),
    fetch(`${E2E_ORIGIN}/api/events/${slug}/participants/search?q=ab`),
    fetch(`${E2E_ORIGIN}/scan/${slug}`, { redirect: 'manual' }),
  ]);
}
