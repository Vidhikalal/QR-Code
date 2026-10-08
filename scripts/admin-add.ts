// `pnpm admin:add you@club.org`  (PLAN F13)
// Registers a platform admin: they can create events at /admin/new and join any event as organizer.
// The account is linked the next time that email signs in (consume_platform_admin in /auth/callback).
// Refuses a non-local Supabase unless you pass --yes (CLAUDE.md: local by default).
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { normalizeEmail } from '@/lib/domain/normalize';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { yes: { type: 'boolean', default: false } } });
  const raw = positionals[0];
  if (!raw || positionals.length > 1) throw new Error('usage: pnpm admin:add <email> [--yes]');
  const email = normalizeEmail(raw);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('that does not look like an email address');

  const url = need('NEXT_PUBLIC_SUPABASE_URL');
  console.log(`Target Supabase: ${url}`);
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) && !values.yes) {
    throw new Error('not a local Supabase; re-run with --yes if you really mean this project');
  }
  const db = createClient<Database>(url, need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { error } = await db.from('platform_admins').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true });
  if (error) throw new Error(`insert failed: ${error.message}`);
  console.log(`${email} is a platform admin. Sign in at /login with that email (sign out and in again if already signed in).`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
