import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { sha256hex } from '@/lib/domain/token';
import { ipKey, withinLimit } from '@/lib/pass/handlers';

type Db = SupabaseClient<Database>;

export interface RsvpDeps {
  db: Db;
  /** Signs the browser in (sets the session cookie); false if it didn't work. */
  signIn: (email: string, password: string) => Promise<boolean>;
  /** Runs `task` after the response is sent (Next.js `after()` in production). */
  scheduleDrain: (task: () => Promise<unknown>) => void;
  drain: () => Promise<unknown>;
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

const lookupSchema = z.object({
  email: z.string(),
  firstName: z.string(),
  status: z.string(),
  hasAccount: z.boolean(),
  event: z.object({ name: z.string(), venue: z.string(), startsAt: z.string(), timezone: z.string() }),
});

const rsvpBody = z
  .object({ token: z.string().max(512), going: z.boolean().optional(), password: z.string().max(200).optional() })
  .strict();

// POST /api/rsvp (SPEC F13, §9.3). The RSVP token travels only in the body (I-3); same per-IP limit as
// /api/pass. `{token}` looks the invitation up; `{token, going, password?}` answers it. A Yes from
// someone without an account creates one with their password (the emailed link proved the address)
// and signs them in. An existing account's password is never changed here.
export function createRsvpHandler(deps: RsvpDeps) {
  return async (request: Request): Promise<Response> => {
    if (!(await withinLimit(deps.db, ipKey(request.headers, 'rsvp'), 60, 30))) return json({ error: 'rate_limited' }, 429);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const body = rsvpBody.safeParse(raw);
    if (!body.success) return json({ error: 'invalid_body' }, 400);

    const hash = sha256hex(body.data.token);
    const { data, error } = await deps.db.rpc('rsvp_lookup', { p_token_hash: hash });
    if (error) throw new Error(`rsvp_lookup failed (${error.code})`);
    if (data === null) return json({ state: 'not_found' }, 404);
    const found = lookupSchema.parse(data);
    const { going, password } = body.data;
    if (going === undefined) {
      return json({ firstName: found.firstName, event: found.event, status: found.status, hasAccount: found.hasAccount });
    }

    const newAccount = going && !found.hasAccount && password !== undefined;
    if (newAccount) {
      // 8–72: bcrypt ignores anything longer. Checked before anything changes.
      if (password.length < 8 || password.length > 72) return json({ error: 'weak_password' }, 400);
      const created = await deps.db.auth.admin.createUser({ email: found.email, password, email_confirm: true });
      if (created.error?.code === 'weak_password') return json({ error: 'weak_password' }, 400);
      // email_exists: made a moment ago (a double tap). Their password stays as it is.
      if (created.error && created.error.code !== 'email_exists') throw new Error(`createUser failed (${created.error.code ?? created.error.status})`);
    }

    const { data: code, error: respondError } = await deps.db.rpc('rsvp_respond', { p_token_hash: hash, p_going: going });
    if (respondError) throw new Error(`rsvp_respond failed (${respondError.code})`);
    if (code === 'NOT_FOUND') return json({ state: 'not_found' }, 404);
    // Never send inline (SPEC §2 Outbox): the pass email goes out after the response.
    if (code === 'GOING') deps.scheduleDrain(deps.drain);
    const signedIn = newAccount ? await deps.signIn(found.email, password) : false;
    return json({ code, signedIn });
  };
}
