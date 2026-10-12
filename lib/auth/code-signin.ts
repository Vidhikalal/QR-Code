import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { normalizeEmail } from '@/lib/domain/normalize';
import { sha256hex } from '@/lib/domain/token';
import { withinLimit } from '@/lib/http/rate-limit';
import { finishSignIn } from './finish-sign-in';
import { safeNextPath } from './next-path';

type Db = SupabaseClient<Database>;
type AuthApi = Pick<SupabaseClient<Database>['auth'], 'signInWithOtp' | 'verifyOtp' | 'signInWithPassword'>;

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const WINDOW = 15 * 60;
const SEND_LIMIT = 5; // per address: no inbox flooding
const VERIFY_LIMIT = 10; // per address: 40 guesses/h against 10^6 codes that expire in 1 h
const PASSWORD_LIMIT = 10; // per address, per 15 min

const email = z.string().max(320).transform(normalizeEmail).pipe(z.email()); // I-12, then validate
const sendBody = z.object({ email, next: z.string().max(500).optional() }).strict();
const verifyBody = z.object({ email, code: z.string().regex(/^\d{6}$/), next: z.string().max(500).optional() }).strict();
const passwordBody = z.object({ email, password: z.string().min(1).max(200), next: z.string().max(500).optional() }).strict();

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

// Same-origin only (login CSRF): the browser's Origin must name the host it is talking to. Checked
// against Host rather than a configured origin, so localhost keeps working while a tunnel runs.
function sameOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return null;
  try {
    return new URL(origin).host === host ? origin : null;
  } catch {
    return null;
  }
}

// Staff sign-in through the app's server: the browser never calls Supabase, so a phone using the app
// through a tunnel can sign in. The magic link in the same email keeps working (/auth/callback).
// `auth` must write the session cookie in production (supabaseForRequest); tests pass a plain client.
// `passwordLogin` (FEATURE_PASSWORD_LOGIN, off by default): a dev convenience for the local admin account.
export function createCodeSignIn(deps: { db: Db; auth: () => AuthApi | Promise<AuthApi>; passwordLogin?: boolean }) {
  const { db } = deps;
  const emailKey = (kind: string, email: string) => `staff-${kind}:email:${sha256hex(email).slice(0, 32)}`;

  return {
    // POST /auth/send-code { email, next }
    async sendCode(request: Request): Promise<Response> {
      const origin = sameOrigin(request);
      if (!origin) return json({ error: 'forbidden' }, 403);
      const body = sendBody.safeParse(await readJson(request));
      if (!body.success) return json({ error: 'invalid_request' }, 400);
      const { email } = body.data;
      if (!(await withinLimit(db, emailKey('send', email), WINDOW, SEND_LIMIT))) return json({ error: 'rate_limited' }, 429);
      const redirect = new URL('/auth/callback', origin);
      redirect.searchParams.set('next', safeNextPath(body.data.next, '/admin'));
      const { error } = await (await deps.auth()).signInWithOtp({ email, options: { emailRedirectTo: redirect.toString() } });
      // Supabase's own limits (min gap per address, hourly email cap) answer 429: say "wait", don't pretend.
      if (error) return json({ error: error.status === 429 ? 'rate_limited' : 'send_failed' }, error.status === 429 ? 429 : 502);
      return json({ code: 'SENT' });
    },

    // POST /auth/verify-code { email, code, next }
    async verifyCode(request: Request): Promise<Response> {
      if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
      const body = verifyBody.safeParse(await readJson(request));
      if (!body.success) return json({ error: 'invalid_request' }, 400);
      const { email } = body.data;
      if (!(await withinLimit(db, emailKey('verify', email), WINDOW, VERIFY_LIMIT))) return json({ error: 'rate_limited' }, 429);
      const { data, error } = await (await deps.auth()).verifyOtp({ email, token: body.data.code, type: 'email' });
      const user = data.user;
      if (error || !user) return json({ code: 'CODE_INVALID' }, 400);
      const next = await finishSignIn(db, { id: user.id, email: user.email ?? null }, safeNextPath(body.data.next, '/admin'));
      return json({ code: 'SIGNED_IN', next });
    },

    // POST /auth/password { email, password, next }  (dev only, FEATURE_PASSWORD_LOGIN)
    async passwordSignIn(request: Request): Promise<Response> {
      if (!deps.passwordLogin) return json({ error: 'not_found' }, 404);
      if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
      const body = passwordBody.safeParse(await readJson(request));
      if (!body.success) return json({ error: 'invalid_request' }, 400);
      const { email, password } = body.data;
      if (!(await withinLimit(db, emailKey('password', email), WINDOW, PASSWORD_LIMIT))) return json({ error: 'rate_limited' }, 429);
      const { data, error } = await (await deps.auth()).signInWithPassword({ email, password });
      const user = data.user;
      if (error || !user) return json({ code: 'INVALID_LOGIN' }, 400); // never says which part was wrong
      const next = await finishSignIn(db, { id: user.id, email: user.email ?? null }, safeNextPath(body.data.next, '/admin'));
      return json({ code: 'SIGNED_IN', next });
    },
  };
}
