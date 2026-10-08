import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { E2E_ORIGIN } from '../fixtures/e2e';

// Every page and API route, as a URL with placeholder params (route groups dropped).
function routeUrls(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeUrls(full, root);
    if (name !== 'page.tsx' && name !== 'route.ts') return [];
    const segments = relative(root, full)
      .split(sep)
      .slice(0, -1)
      .filter((s) => !/^\(.*\)$/.test(s))
      .map((s) => (s.startsWith('[') ? 'warmup' : s));
    return [`/${segments.join('/')}`];
  });
}

export default async function globalSetup(): Promise<void> {
  // Marks the start of this e2e run, so the audit project only judges rows and log lines from it.
  mkdirSync('.e2e', { recursive: true });
  writeFileSync('.e2e/run-started', new Date().toISOString());

  // `next dev` compiles each route on its first request, and a compile in one worker slows every
  // request in the other (T-SCUI-01 measures 1.5 s). Compile everything once, before any test runs.
  // Status codes don't matter: unauthenticated requests still compile the route.
  for (const path of routeUrls(join(process.cwd(), 'app'))) {
    await fetch(`${E2E_ORIGIN}${path}`, { redirect: 'manual' }).catch(() => undefined);
  }
}
