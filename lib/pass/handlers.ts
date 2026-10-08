import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { passState, type PassLookup } from '@/lib/domain/pass-state';
import { sha256hex } from '@/lib/domain/token';
import { hashedClientIp, withinLimit } from '@/lib/http/rate-limit';
import { MAX_PHOTO_REQUEST_BYTES, storeParticipantPhoto } from '@/lib/photo/process';
import { signedPhotoUrl } from '@/lib/storage/photos';

type Db = SupabaseClient<Database>;

export { MAX_PHOTO_BYTES } from '@/lib/photo/process';

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

const lookupSchema = z.object({
  pass: z.object({ id: z.string(), revokedAt: z.string().nullable(), revokeReason: z.string().nullable() }),
  participant: z.object({
    id: z.string(),
    eventId: z.string(),
    firstName: z.string(),
    status: z.string(),
    deleted: z.boolean(),
    photoPath: z.string().nullable(),
    photoUpdatedAt: z.string().nullable(),
  }),
  event: z.object({ name: z.string(), venue: z.string(), startsAt: z.string(), timezone: z.string() }),
  checkedIn: z.boolean(),
});

// Any string is hashed and looked up, so malformed and unknown tokens take the same path (T-PASS-02).
async function lookupToken(db: Db, token: string): Promise<PassLookup | null> {
  const { data, error } = await db.rpc('pass_lookup', { p_token_hash: sha256hex(token) });
  if (error) throw new Error(`pass_lookup failed (${error.code})`);
  return data === null ? null : lookupSchema.parse(data);
}

const ipKey = (request: Request) => `pass:ip:${hashedClientIp(request)}`;

const passBody = z.object({ token: z.string().max(512) }).strict();

// POST /api/pass (SPEC F5, §9.3): token in the body only, never in a URL (I-3).
export function createPassHandler(deps: { db: Db }) {
  return async (request: Request): Promise<Response> => {
    if (!(await withinLimit(deps.db, ipKey(request), 60, 30))) return json({ error: 'rate_limited' }, 429);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const body = passBody.safeParse(raw);
    if (!body.success) return json({ error: 'invalid_body' }, 400);

    const found = await lookupToken(deps.db, body.data.token);
    const state = passState(found);
    if (state === 'not_found' || !found) return json({ state: 'not_found' }, 404);
    if (state !== 'active') return json({ state });

    const { participant, event } = found;
    return json({
      state,
      firstName: participant.firstName,
      event,
      photo: {
        url: participant.photoPath ? await signedPhotoUrl(deps.db, participant.photoPath) : null,
        updatedAt: participant.photoUpdatedAt,
      },
      photoLocked: found.checkedIn,
    });
  };
}

// POST /api/pass/photo (SPEC F5): multipart { token, file }.
export function createPhotoHandler(deps: { db: Db }) {
  return async (request: Request): Promise<Response> => {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_PHOTO_REQUEST_BYTES) return json({ error: 'too_large' }, 413);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const token = form.get('token');
    const file = form.get('file');
    if (typeof token !== 'string' || !(file instanceof File)) return json({ error: 'invalid_body' }, 400);

    const found = await lookupToken(deps.db, token);
    if (passState(found) !== 'active' || !found) return json({ error: 'not_found' }, 404);
    if (!(await withinLimit(deps.db, `photo:pass:${found.pass.id}`, 3600, 10))) return json({ error: 'rate_limited' }, 429);
    if (found.checkedIn) return json({ error: 'PHOTO_LOCKED' }, 409);
    const stored = await storeParticipantPhoto(deps.db, { eventId: found.participant.eventId, participantId: found.participant.id }, file);
    if (!stored.ok) return json({ error: stored.error }, stored.status);
    const { photoUpdatedAt } = stored;
    return json({ ok: true, photoUpdatedAt });
  };
}
