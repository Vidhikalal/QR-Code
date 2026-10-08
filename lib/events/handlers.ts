import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Authenticate } from '@/lib/auth/session';
import type { Database } from '@/lib/db/types.gen';
import { zonedToUtc } from '@/lib/domain/event-time';
import { isPlatformAdmin } from './queries';
import { eventSlugSchema } from './slug';

type Db = SupabaseClient<Database>;
type Params = Record<string, string>;

export interface EventsDeps {
  db: Db;
  authenticate: Authenticate;
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

// Wall-clock time in the event's own time zone (I-8): the organizer types what the poster says.
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

const createBody = z
  .object({
    slug: eventSlugSchema,
    name: z.string().trim().min(1).max(120),
    venue: z.string().trim().min(1).max(200),
    startsAt: localDateTime,
    endsAt: localDateTime,
    timezone: z.string().min(1).max(64),
  })
  .strict();

export type CreateEventCode = 'CREATED' | 'FORBIDDEN' | 'INVALID_TIMEZONE' | 'INVALID_DATES' | 'SLUG_TAKEN';

function isKnownZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// PLAN F13/F14. Platform admins create events and can join any event as organizer. Admin status
// is checked before the body is even parsed, so non-admins always get 403 (T-ADM-01, T-EVT-10).
export function createEventsApi(deps: EventsDeps) {
  const { db } = deps;

  async function requireAdmin(request: Request): Promise<{ userId: string } | Response> {
    const user = await deps.authenticate(request);
    if (!user) return json({ error: 'unauthorized' }, 401);
    if (!(await isPlatformAdmin(db, user.id))) return json({ error: 'forbidden' }, 403);
    return { userId: user.id };
  }

  return {
    // POST /api/admin/events
    async createEvent(request: Request) {
      const g = await requireAdmin(request);
      if (g instanceof Response) return g;
      const body = createBody.safeParse(await request.json().catch(() => undefined));
      if (!body.success) return json({ error: 'invalid_request' }, 400);
      const b = body.data;
      if (!isKnownZone(b.timezone)) return json({ code: 'INVALID_TIMEZONE' });
      const { data, error } = await db.rpc('create_event', {
        p_admin_id: g.userId,
        p_slug: b.slug,
        p_name: b.name,
        p_venue: b.venue,
        p_starts_at: zonedToUtc(b.startsAt, b.timezone),
        p_ends_at: zonedToUtc(b.endsAt, b.timezone),
        p_timezone: b.timezone,
      });
      if (error) throw new Error(`create_event failed (${error.code})`);
      const r = z.object({ code: z.enum(['CREATED', 'FORBIDDEN', 'INVALID_TIMEZONE', 'INVALID_DATES', 'SLUG_TAKEN']), eventId: z.string().optional() }).parse(data);
      if (r.code === 'FORBIDDEN') return json({ error: 'forbidden' }, 403);
      return json(r.code === 'CREATED' ? { code: r.code, eventId: r.eventId, slug: b.slug } : { code: r.code });
    },

    // POST /api/admin/events/[id]/join
    async joinEvent(request: Request, params: Params) {
      const g = await requireAdmin(request);
      if (g instanceof Response) return g;
      const eventId = z.uuid().safeParse(params.id).data;
      if (!eventId) return json({ error: 'not_found' }, 404);
      const { data, error } = await db.rpc('join_event_as_admin', { p_admin_id: g.userId, p_event_id: eventId });
      if (error) throw new Error(`join_event_as_admin failed (${error.code})`);
      if (data === 'NOT_FOUND') return json({ error: 'not_found' }, 404);
      if (data === 'FORBIDDEN') return json({ error: 'forbidden' }, 403);
      return json({ code: data });
    },
  };
}

export type EventsApi = ReturnType<typeof createEventsApi>;
