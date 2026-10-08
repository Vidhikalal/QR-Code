import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
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
