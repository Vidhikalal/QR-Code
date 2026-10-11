import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCodeSignIn } from '@/lib/auth/code-signin';
import type { Database } from '@/lib/db/types.gen';
import { requireEnv } from '../fixtures/db';
import { serviceClient } from '../fixtures/mail';
import { latestSignInCode } from '../fixtures/mailpit';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// Staff sign-in with the emailed 6-digit code, through the app's server (phones can't reach the
// local Supabase). Same post-sign-in steps as the magic-link callback (SPEC F9, PLAN F13).
let f: StandardFixture;
const anonAuth = () =>
  createClient<Database>(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth;
const api = createCodeSignIn({ db: serviceClient(), auth: anonAuth });
const ORIGIN = 'http://localhost:3000';
const post = (handler: 'sendCode' | 'verifyCode', body: unknown, headers: Record<string, string> = { origin: ORIGIN, host: 'localhost:3000' }) =>
  api[handler](new Request(`${ORIGIN}/auth/x`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));

beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

describe('staff sign-in with a code', () => {
  it('sends a code: the same answer for any address; foreign Origin → 403; bad body → 400', async () => {
    const known = await post('sendCode', { email: f.staffEmail.vol1, next: '/admin' });
    const unknown = await post('sendCode', { email: `nobody-${randomUUID().slice(0, 8)}@example.test`, next: '/admin' });
    expect([known.status, await known.json()]).toEqual([200, { code: 'SENT' }]);
    expect([unknown.status, await unknown.json()]).toEqual([200, { code: 'SENT' }]);
    expect((await post('sendCode', { email: f.staffEmail.vol1, next: '/admin' }, { origin: 'https://evil.example', host: 'localhost:3000' })).status).toBe(403);
    expect((await post('sendCode', { email: f.staffEmail.vol1, next: '/admin' }, { host: 'localhost:3000' })).status).toBe(403);
    expect((await post('sendCode', { email: 'not-an-email' })).status).toBe(400);
  });

  it('the emailed code signs a new invitee in, consumes the invite and sends them to onboarding; a wrong code does not', async () => {
    const email = `code-${f.slug}@example.test`;
    await f.pool.query(`insert into staff_invites (event_id, email, role) values ($1, $2, 'volunteer')`, [f.e1.id, email]);
    const started = Date.now();
    expect((await post('sendCode', { email: ` ${email.toUpperCase()} `, next: '/scan/x' })).status).toBe(200);
    const code = await latestSignInCode(email, started);
    const wrong = await post('verifyCode', { email, code: code === '000000' ? '111111' : '000000', next: '/scan/x' });
    expect([wrong.status, await wrong.json()]).toEqual([400, { code: 'CODE_INVALID' }]);
    const ok = await post('verifyCode', { email, code, next: '/scan/x' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ code: 'SIGNED_IN', next: '/onboarding?next=%2Fscan%2Fx' });
    const { rows } = await f.pool.query(`select es.role from event_staff es join auth.users u on u.id = es.user_id where u.email = $1 and es.event_id = $2`, [email, f.e1.id]);
    expect(rows).toEqual([{ role: 'volunteer' }]);
    expect((await post('verifyCode', { email, code, next: '/scan/x' })).status).toBe(400); // single use
  });

  it('an existing staff member goes straight to next; next is kept same-site', async () => {
    const started = Date.now();
    await post('sendCode', { email: f.staffEmail.org1, next: '/admin' });
    const code = await latestSignInCode(f.staffEmail.org1, started);
    const ok = await post('verifyCode', { email: f.staffEmail.org1, code, next: 'https://evil.example/x' });
    expect(await ok.json()).toEqual({ code: 'SIGNED_IN', next: '/admin' });
  });

  it('11th verify attempt for one address within 15 minutes → 429; malformed code → 400', async () => {
    const email = `brute-${randomUUID().slice(0, 8)}@example.test`;
    for (let i = 0; i < 10; i++) expect((await post('verifyCode', { email, code: '123456', next: '/admin' })).status).toBe(400);
    expect((await post('verifyCode', { email, code: '123456', next: '/admin' })).status).toBe(429);
    expect((await post('verifyCode', { email: f.staffEmail.vol2, code: '12345', next: '/admin' })).status).toBe(400);
  });

  it('6th send for one address within 15 minutes → 429', { timeout: 20_000 }, async () => {
    const email = `spam-${randomUUID().slice(0, 8)}@example.test`;
    for (let i = 0; i < 5; i++) {
      expect((await post('sendCode', { email, next: '/admin' })).status).toBe(200);
      await new Promise((r) => setTimeout(r, 1100)); // Supabase's own 1 s gap per address (config.toml)
    }
    expect((await post('sendCode', { email, next: '/admin' })).status).toBe(429);
  });
});
