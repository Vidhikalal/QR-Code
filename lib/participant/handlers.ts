import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { normalizeEmail } from '@/lib/domain/normalize';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { fromOrigin } from '@/lib/http/origin';
import { hashedClientIp, withinLimit } from '@/lib/http/rate-limit';
import { clearParticipantCookie, readSessionValue, serializeParticipantCookie } from './session';

type Db = SupabaseClient<Database>;

export interface ParticipantDeps {
  db: Db;
  /** The ME origin (NEXT_PUBLIC_APP_ORIGIN): cookie naming and the Origin check. */
  meOrigin: string;
  sessionDays: number;
  /** Runs the outbox drainer after the response (Next.js `after()`), so a new link goes out promptly. */
  scheduleDrain?: () => void;
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200, cookie?: string) =>
  Response.json(body, { status, headers: cookie ? { ...NO_STORE, 'Set-Cookie': cookie } : NO_STORE });

const keyBody = z.object({ key: z.string().min(1).max(512) }).strict();
const openResult = z.object({ code: z.enum(['OPENED', 'KEY_NOT_FOUND', 'KEY_REVOKED', 'NOT_ELIGIBLE']) });
const codeBody = z.object({ code: z.string().min(1).max(512) }).strict();
const redeemResult = z.object({ code: z.enum(['OPENED', 'CODE_INVALID', 'NOT_ELIGIBLE']) });
const linkBody = z
  .object({ eventSlug: z.string().min(1).max(40), email: z.string().max(320).transform(normalizeEmail).pipe(z.email()) })
  .strict();

// Resolves the session cookie through session_participant() (I-20): valid, unexpired, unrevoked, and
// the person still accepted and not deleted. Null otherwise.
export async function readParticipant(db: Db, request: Request, meOrigin: string): Promise<{ participantId: string; sessionHash: string } | null> {
  const value = readSessionValue(request.headers.get('cookie'), meOrigin);
  if (!value) return null;
  const sessionHash = sha256hex(value);
  const { data, error } = await db.rpc('session_participant', { p_session_hash: sessionHash });
  if (error) throw new Error(`session_participant failed (${error.code})`);
  return data ? { participantId: data, sessionHash } : null;
}

// PLAN F17/F18 on the ME host. Mutations check Origin first (T-SEC2-06); secrets travel only in the
// POST body and the HttpOnly cookie, and only their hashes reach the database (I-18).
export function createParticipantApi(deps: ParticipantDeps) {
  const { db, meOrigin } = deps;
  const forbidden = () => json({ error: 'forbidden' }, 403);
  const unauthorized = (clear = false) => json({ error: 'unauthorized' }, 401, clear ? clearParticipantCookie(meOrigin) : undefined);

  return {
    // POST /api/me/session { key }  (the edit link, F17)
    async openSession(request: Request) {
      if (!fromOrigin(request, meOrigin)) return forbidden();
      if (!(await withinLimit(db, `me-session:ip:${hashedClientIp(request)}`, 60, 30))) return json({ error: 'rate_limited' }, 429);
      const body = keyBody.safeParse(await request.json().catch(() => undefined));
      if (!body.success) return json({ error: 'invalid_request' }, 400);
      const value = generateSecret();
      const { data, error } = await db.rpc('open_profile_session', {
        p_key_hash: sha256hex(body.data.key),
        p_session_hash: sha256hex(value),
        p_ttl: `${deps.sessionDays} days`,
      });
      if (error) throw new Error(`open_profile_session failed (${error.code})`);
      const { code } = openResult.parse(data);
      if (code === 'OPENED') return json({ code, next: '/me' }, 200, serializeParticipantCookie(value, meOrigin, deps.sessionDays));
      if (code === 'KEY_REVOKED') return json({ code });
      // Unknown key and ineligible person look the same from outside.
      return json({ code: 'LINK_INVALID' });
    },

    // POST /api/me/session/code { code }  (a staff hand-off or organizer-hop sign-in code, F18)
    async redeemCode(request: Request) {
      if (!fromOrigin(request, meOrigin)) return forbidden();
      if (!(await withinLimit(db, `me-session:ip:${hashedClientIp(request)}`, 60, 30))) return json({ error: 'rate_limited' }, 429);
      const body = codeBody.safeParse(await request.json().catch(() => undefined));
      if (!body.success) return json({ error: 'invalid_request' }, 400);
      const value = generateSecret();
      const { data, error } = await db.rpc('redeem_signin_code', {
        p_code_hash: sha256hex(body.data.code),
        p_session_hash: sha256hex(value),
        p_ttl: `${deps.sessionDays} days`,
      });
      if (error) throw new Error(`redeem_signin_code failed (${error.code})`);
      const { code } = redeemResult.parse(data);
      if (code === 'OPENED') return json({ code, next: '/me' }, 200, serializeParticipantCookie(value, meOrigin, deps.sessionDays));
      return json({ code: 'CODE_INVALID' });
    },

    // POST /api/signin/request { eventSlug, email }  ("Email me a link", F18). The answer never says
    // whether the address is registered (T-SESS-08); the email goes only to the address on file.
    async requestLink(request: Request) {
      if (!fromOrigin(request, meOrigin)) return forbidden();
      const body = linkBody.safeParse(await request.json().catch(() => undefined));
      if (!body.success) return json({ error: 'invalid_request' }, 400);
      const { eventSlug, email } = body.data;
      const limited =
        !(await withinLimit(db, `signin-request:ip:${hashedClientIp(request)}`, 3600, 20)) ||
        !(await withinLimit(db, `signin-request:email:${sha256hex(email).slice(0, 32)}`, 3600, 3));
      if (limited) return json({ error: 'rate_limited' }, 429);
      const { data: person, error } = await db
        .from('participants')
        .select('id, events!inner(slug)')
        .eq('events.slug', eventSlug)
        .eq('email', email)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw new Error(`participant lookup failed (${error.code})`);
      if (person) {
        const { data: queued, error: linkError } = await db.rpc('request_profile_link', { p_participant_id: person.id });
        if (linkError) throw new Error(`request_profile_link failed (${linkError.code})`);
        if (queued === 'QUEUED') deps.scheduleDrain?.();
      }
      return json({ code: 'SENT_IF_REGISTERED' });
    },

    // DELETE /api/me/session  (sign out this device only)
    async endSession(request: Request) {
      if (!fromOrigin(request, meOrigin)) return forbidden();
      const who = await readParticipant(db, request, meOrigin);
      if (!who) return unauthorized(true);
      const { error } = await db.rpc('end_profile_session', { p_session_hash: who.sessionHash });
      if (error) throw new Error(`end_profile_session failed (${error.code})`);
      return json({ code: 'SIGNED_OUT' }, 200, clearParticipantCookie(meOrigin));
    },

    // POST /api/me/rotate  ("Get a new link": every key and every device, then email a fresh link)
    async rotate(request: Request) {
      if (!fromOrigin(request, meOrigin)) return forbidden();
      const who = await readParticipant(db, request, meOrigin);
      if (!who) return unauthorized(true);
      // rotate_profile_keys needs a replacement key; it is never sent anywhere. The working link is
      // minted by the drainer for the profile_link email, so keys only ever leave inside an email.
      const { error } = await db.rpc('rotate_profile_keys', { p_participant_id: who.participantId, p_new_key_hash: sha256hex(generateSecret()) });
      if (error) throw new Error(`rotate_profile_keys failed (${error.code})`);
      const { error: linkError } = await db.rpc('request_profile_link', { p_participant_id: who.participantId });
      if (linkError) throw new Error(`request_profile_link failed (${linkError.code})`);
      deps.scheduleDrain?.();
      return json({ code: 'ROTATED' }, 200, clearParticipantCookie(meOrigin));
    },

    // GET /api/me  (the minimal /me page data; the full profile arrives in V3)
    async me(request: Request) {
      const who = await readParticipant(db, request, meOrigin);
      if (!who) return unauthorized();
      return json(await participantSummary(db, who.participantId));
    },
  };
}

export async function participantSummary(db: Db, participantId: string): Promise<{ firstName: string; event: { name: string } }> {
  const { data, error } = await db.from('participants').select('first_name, events(name)').eq('id', participantId).single();
  if (error) throw new Error(`participant load failed (${error.code})`);
  return { firstName: data.first_name, event: { name: data.events.name } };
}

export type ParticipantApi = ReturnType<typeof createParticipantApi>;
