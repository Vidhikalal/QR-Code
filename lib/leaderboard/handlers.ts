import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Authenticate } from '@/lib/auth/session';
import { requireStaffBySlug } from '@/lib/auth/staff';
import type { Database } from '@/lib/db/types.gen';
import { leaderboardAsOf } from './as-of';

type Db = SupabaseClient<Database>;
type Params = Record<string, string>;
export type BoardKind = 'activity' | 'networking';

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export interface BoardSettings {
  timezone: string;
  startsAt: string;
  refreshMinutes: number;
  frozenAt: string | null;
}

export async function boardSettings(db: Db, eventId: string): Promise<BoardSettings> {
  const { data, error } = await db.from('events').select('timezone, starts_at, leaderboard_refresh_minutes, leaderboard_frozen_at').eq('id', eventId).single();
  if (error) throw new Error(`event load failed (${error.code})`);
  return { timezone: data.timezone, startsAt: data.starts_at, refreshMinutes: data.leaderboard_refresh_minutes, frozenAt: data.leaderboard_frozen_at };
}

// "Live" means everything the database has committed, by its own clock (I-7): the app server's clock
// can trail Postgres by a few hundred ms, which would hide a scan made a moment ago.
const LIVE = 'infinity';
const sqlAsOf = (asOf: Date | 'live') => (asOf === 'live' ? LIVE : asOf.toISOString());

/** leaderboard() as of a moment. Rows with participant ids: callers decide what leaves the server. */
export async function boardRows(db: Db, eventId: string, kind: BoardKind, asOf: Date | 'live', limit: number) {
  const { data, error } = await db.rpc('leaderboard', { p_event_id: eventId, p_kind: kind, p_as_of: sqlAsOf(asOf), p_limit: limit });
  if (error) throw new Error(`leaderboard failed (${error.code})`);
  return data;
}

// PLAN F25 / §9.2. Organizer-only (T-ADM-01: every /api/admin route refuses volunteers).
export function createLeaderboardApi(deps: { db: Db; authenticate: Authenticate; now?: () => Date }) {
  const { db } = deps;
  const now = () => (deps.now ?? (() => new Date()))();

  async function organizer(request: Request, params: Params): Promise<{ userId: string; eventId: string } | Response> {
    const user = await deps.authenticate(request);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const staff = await requireStaffBySlug(db, user.id, params.slug ?? '', 'organizer');
    if (!staff) return json({ error: 'forbidden' }, 403);
    return { userId: user.id, eventId: staff.eventId };
  }

  return {
    // GET /api/admin/[slug]/leaderboard?kind=&limit=  (rank, display name, points only: T-LB-08)
    async get(request: Request, params: Params) {
      const g = await organizer(request, params);
      if (g instanceof Response) return g;
      const url = new URL(request.url);
      const q = z
        .object({ kind: z.enum(['activity', 'networking']), limit: z.coerce.number().int().min(1).max(50).default(10) })
        .safeParse({ kind: url.searchParams.get('kind'), limit: url.searchParams.get('limit') ?? undefined });
      if (!q.success) return json({ error: 'invalid_request' }, 400);
      const s = await boardSettings(db, g.eventId);
      const { asOf, nextRefreshAt } = leaderboardAsOf({ now: now(), startsAt: s.startsAt, refreshMinutes: s.refreshMinutes, frozenAt: s.frozenAt });
      const live = s.refreshMinutes <= 0 && s.frozenAt === null;
      const rows = await boardRows(db, g.eventId, q.data.kind, live ? 'live' : asOf, q.data.limit);
      return json({
        kind: q.data.kind,
        asOf: asOf.toISOString(),
        nextRefreshAt: nextRefreshAt?.toISOString() ?? null,
        frozenAt: s.frozenAt,
        refreshMinutes: s.refreshMinutes,
        timezone: s.timezone,
        rows: rows.map((r) => ({ rank: r.rank, displayName: r.display_name, points: r.points })),
      });
    },

    // POST /api/admin/[slug]/leaderboard/freeze { frozen }  (audited, no detail)
    async freeze(request: Request, params: Params) {
      const g = await organizer(request, params);
      if (g instanceof Response) return g;
      const body = z.object({ frozen: z.boolean() }).strict().safeParse(await request.json().catch(() => undefined));
      if (!body.success) return json({ error: 'invalid_request' }, 400);
      const at = body.data.frozen ? now().toISOString() : null;
      const { error } = await db.from('events').update({ leaderboard_frozen_at: at }).eq('id', g.eventId);
      if (error) throw new Error(`freeze failed (${error.code})`);
      const { error: auditError } = await db.from('audit_log').insert({
        event_id: g.eventId,
        actor_user_id: g.userId,
        actor_kind: 'staff',
        action: body.data.frozen ? 'leaderboard.freeze' : 'leaderboard.unfreeze',
      });
      if (auditError) throw new Error(`audit_log insert failed (${auditError.code})`);
      return json({ frozenAt: at });
    },
  };
}

export type LeaderboardApi = ReturnType<typeof createLeaderboardApi>;

/** PLAN F25: a participant's own live points, and their rank as of the projector's time. */
export async function myPoints(db: Db, participantId: string, at: Date) {
  const { data: pa, error } = await db.from('participants').select('event_id').eq('id', participantId).single();
  if (error) throw new Error(`participant load failed (${error.code})`);
  const { data: live, error: liveError } = await db.rpc('points_as_of', { p_event_id: pa.event_id, p_as_of: LIVE });
  if (liveError) throw new Error(`points_as_of failed (${liveError.code})`);
  const mine = live.find((r) => r.participant_id === participantId);
  const s = await boardSettings(db, pa.event_id);
  const { asOf } = leaderboardAsOf({ now: at, startsAt: s.startsAt, refreshMinutes: s.refreshMinutes, frozenAt: s.frozenAt });
  const onScreen = s.refreshMinutes <= 0 && s.frozenAt === null ? 'live' : asOf;
  const rank = async (kind: BoardKind) => (await boardRows(db, pa.event_id, kind, onScreen, 10_000)).find((r) => r.participant_id === participantId)?.rank ?? null;
  return { activity: mine?.activity ?? 0, networking: mine?.networking ?? 0, activityRank: await rank('activity'), networkingRank: await rank('networking'), screenAsOf: asOf.toISOString() };
}
