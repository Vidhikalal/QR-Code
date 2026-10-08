import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Authenticate } from '@/lib/auth/session';
import { requireStaffBySlug, type StaffRole } from '@/lib/auth/staff';
import { mintPublicId } from '@/lib/badge/mint';
import { isPublicId, normalizeUid, parseTagCsv, tagUrl } from '@/lib/badge/tags';
import type { Database } from '@/lib/db/types.gen';
import { toCsv } from '@/lib/domain/csv';
import { withinLimit } from '@/lib/http/rate-limit';

type Db = SupabaseClient<Database>;
type Params = Record<string, string>;

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const MB = 1024 * 1024;
const MAX_IMPORT_ROWS = 2000;
const RESERVED_TTL_MS = 60 * 60 * 1000;

const publicIdField = z.string().refine(isPublicId);
const assignBody = z
  .object({
    eventSlug: z.string().min(1).max(40),
    participantId: z.uuid(),
    tagPublicId: publicIdField.optional(),
    tagUid: z.string().max(64).optional(),
    replace: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.tagPublicId !== undefined || b.tagUid !== undefined);

const registerCode = z.enum(['REGISTERED', 'ALREADY_REGISTERED', 'UID_CONFLICT', 'PUBLIC_ID_CONFLICT', 'FORBIDDEN']);
const reserveResult = z.object({ code: z.enum(['RESERVED', 'FORBIDDEN', 'PUBLIC_ID_CONFLICT']), label: z.string().optional() });

async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => undefined);
}

// PLAN §6.5 / §9.2 (V4a). Organizer endpoints under /api/admin/[slug]/tags; staff endpoints (assign,
// unassign, stations) are served on both hosts (I-23). A badge id never authorizes anything (I-16):
// every call needs a staff session, and the SQL functions re-check event membership.
export function createTagsApi(deps: { db: Db; authenticate: Authenticate; meOrigin: string; now?: () => Date }) {
  const { db } = deps;
  const now = () => (deps.now ?? (() => new Date()))();

  async function staffOf(request: Request, slug: string, role?: StaffRole): Promise<{ userId: string; eventId: string } | Response> {
    const user = await deps.authenticate(request);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const staff = await requireStaffBySlug(db, user.id, slug, role);
    if (!staff) return json({ error: 'forbidden' }, 403);
    return { userId: user.id, eventId: staff.eventId };
  }

  async function reserveOne(eventId: string, userId: string): Promise<{ publicId: string; label: string } | 'FORBIDDEN'> {
    // A collision of 72 random bits won't happen, but retrying costs nothing.
    for (let attempt = 0; attempt < 3; attempt++) {
      const publicId = mintPublicId();
      const { data, error } = await db.rpc('reserve_tag', { p_event_id: eventId, p_staff_id: userId, p_public_id: publicId });
      if (error) throw new Error(`reserve_tag failed (${error.code})`);
      const r = reserveResult.parse(data);
      if (r.code === 'FORBIDDEN') return 'FORBIDDEN';
      if (r.code === 'RESERVED' && r.label) return { publicId, label: r.label };
    }
    throw new Error('reserve_tag kept colliding');
  }

  return {
    // GET /api/admin/[slug]/tags  (Badges page: counts + table)
    async list(request: Request, params: Params) {
      const g = await staffOf(request, params.slug ?? '', 'organizer');
      if (g instanceof Response) return g;
      const { data, error } = await db
        .from('tags')
        .select('id, label, uid, registered_at, retired_at, retire_reason, tag_assignments(assigned_at, ended_at, participants(first_name, last_name))')
        .eq('event_id', g.eventId)
        .order('label');
      if (error) throw new Error(`tags load failed (${error.code})`);
      const cutoff = now().getTime() - RESERVED_TTL_MS;
      const tags = data.map((t) => {
        const active = t.tag_assignments.find((a) => a.ended_at === null);
        const state = t.retired_at ? 'retired' : active ? 'linked' : t.uid ? 'unlinked' : 'reserved';
        return {
          id: t.id,
          label: t.label,
          state,
          retireReason: t.retire_reason,
          holder: active ? `${active.participants.first_name} ${active.participants.last_name}`.trim() : null,
          linkedAt: active?.assigned_at ?? null,
          stale: state === 'reserved' && new Date(t.registered_at).getTime() < cutoff,
        };
      });
      const count = (s: string) => tags.filter((t) => t.state === s && !t.stale).length;
      return json({
        counts: {
          registered: tags.filter((t) => t.state !== 'reserved').length,
          linked: count('linked'),
          unlinked: count('unlinked'),
          retired: count('retired'),
          reserved: count('reserved'),
        },
        tags: tags.filter((t) => !t.stale),
      });
    },

    // POST /api/admin/[slug]/tags/reserve  (Register page step 2: the server mints the id)
    async reserve(request: Request, params: Params) {
      const g = await staffOf(request, params.slug ?? '', 'organizer');
      if (g instanceof Response) return g;
      if (!(await withinLimit(db, `tags-reserve:user:${g.userId}`, 3600, 600))) return json({ error: 'rate_limited' }, 429);
      const r = await reserveOne(g.eventId, g.userId);
      if (r === 'FORBIDDEN') return json({ error: 'forbidden' }, 403);
      return json({ ...r, url: tagUrl(deps.meOrigin, r.publicId) });
    },

    // POST /api/admin/[slug]/tags/confirm { publicId, uid }  (Register page step 4)
    async confirm(request: Request, params: Params) {
      const g = await staffOf(request, params.slug ?? '', 'organizer');
      if (g instanceof Response) return g;
      const body = z.object({ publicId: publicIdField, uid: z.string().max(64) }).strict().safeParse(await readJson(request));
      const uid = body.success ? normalizeUid(body.data.uid) : null;
      if (!body.success || !uid) return json({ error: 'invalid_request' }, 400);
      const { data, error } = await db.rpc('register_tag', { p_event_id: g.eventId, p_staff_id: g.userId, p_public_id: body.data.publicId, p_uid: uid });
      if (error) throw new Error(`register_tag failed (${error.code})`);
      return json({ code: registerCode.parse(data) });
    },

    // POST /api/admin/[slug]/tags/import  (vendor CSV body, ≤ 1 MB, ≤ 2,000 rows; per-row codes in order)
    async importCsv(request: Request, params: Params) {
      const g = await staffOf(request, params.slug ?? '', 'organizer');
      if (g instanceof Response) return g;
      const text = await request.text();
      if (Buffer.byteLength(text) > MB) return json({ error: 'too_large' }, 413);
      const parsed = parseTagCsv(text, deps.meOrigin);
      if (!parsed.ok || parsed.rows.length === 0 || parsed.rows.length > MAX_IMPORT_ROWS) return json({ error: 'invalid_request' }, 400);
      const results: Array<{ row: number; code: string }> = [];
      for (const r of parsed.rows) {
        if ('error' in r) {
          results.push({ row: r.row, code: `INVALID:${r.error}` });
          continue;
        }
        const { data, error } = await db.rpc('register_tag', { p_event_id: g.eventId, p_staff_id: g.userId, p_public_id: r.publicId, p_uid: r.uid, p_label: r.label ?? undefined });
        if (error?.code === '23505') {
          results.push({ row: r.row, code: 'LABEL_CONFLICT' }); // label already used in this event
          continue;
        }
        if (error) throw new Error(`register_tag failed (${error.code})`);
        results.push({ row: r.row, code: registerCode.parse(data) });
      }
      return json({ results });
    },

    // GET /api/admin/[slug]/tags/export-ids?count=N  (ids WE generate, for a vendor to encode)
    async exportIds(request: Request, params: Params) {
      const g = await staffOf(request, params.slug ?? '', 'organizer');
      if (g instanceof Response) return g;
      const count = z.coerce.number().int().min(1).max(1000).safeParse(new URL(request.url).searchParams.get('count'));
      if (!count.success) return json({ error: 'invalid_request' }, 400);
      const rows: string[][] = [];
      for (let i = 0; i < count.data; i++) {
        const r = await reserveOne(g.eventId, g.userId);
        if (r === 'FORBIDDEN') return json({ error: 'forbidden' }, 403);
        rows.push([tagUrl(deps.meOrigin, r.publicId), r.publicId, r.label]);
      }
      return new Response(toCsv(['url', 'public_id', 'label'], rows), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${params.slug}-badge-ids.csv"`, ...NO_STORE },
      });
    },

    // POST /api/tags/assign  (door step / Replace badge; staff of the event, both hosts)
    async assign(request: Request) {
      const user = await deps.authenticate(request);
      if (!user) return json({ error: 'unauthorized' }, 401);
      const body = assignBody.safeParse(await readJson(request));
      if (!body.success) return json({ error: 'invalid_request' }, 400);
      const b = body.data;
      const uid = b.tagUid === undefined ? null : normalizeUid(b.tagUid);
      if (b.tagUid !== undefined && !uid) return json({ error: 'invalid_request' }, 400);
      const staff = await requireStaffBySlug(db, user.id, b.eventSlug);
      if (!staff) return json({ error: 'forbidden' }, 403);
      const { data, error } = await db.rpc('assign_tag', {
        p_event_id: staff.eventId,
        p_staff_id: user.id,
        p_participant_id: b.participantId,
        p_public_id: sqlNull(b.tagPublicId ?? null),
        p_uid: sqlNull(b.tagPublicId ? null : uid),
        p_replace: b.replace ?? false,
      });
      if (error) throw new Error(`assign_tag failed (${error.code})`);
      return json(withoutPhotoPath(data));
    },

    // POST /api/tags/unassign { assignmentId }
    async unassign(request: Request) {
      const user = await deps.authenticate(request);
      if (!user) return json({ error: 'unauthorized' }, 401);
      const body = z.object({ assignmentId: z.uuid() }).strict().safeParse(await readJson(request));
      if (!body.success) return json({ error: 'invalid_request' }, 400);
      const { data, error } = await db.rpc('unassign_tag', { p_assignment_id: body.data.assignmentId, p_staff_id: user.id });
      if (error) throw new Error(`unassign_tag failed (${error.code})`);
      return json({ code: data });
    },

    // POST /api/stations { checkpointId }  (the scanner's checkpoint picker; read by the badge page)
    async setStation(request: Request) {
      const user = await deps.authenticate(request);
      if (!user) return json({ error: 'unauthorized' }, 401);
      const body = z.object({ checkpointId: z.uuid() }).strict().safeParse(await readJson(request));
      if (!body.success) return json({ error: 'invalid_request' }, 400);
      const { data, error } = await db.rpc('set_staff_station', { p_user_id: user.id, p_checkpoint_id: body.data.checkpointId });
      if (error) throw new Error(`set_staff_station failed (${error.code})`);
      return json({ code: data });
    },
  };
}

// Generated RPC types mark every argument non-null, but assign_tag takes either identifier as SQL null
// (_find_tag). Omitting the key instead makes PostgREST miss the function (PGRST202).
function sqlNull(v: string | null): string {
  return v as string;
}

// _tag_holder() includes the storage path of the holder's photo; the browser never needs it.
function withoutPhotoPath(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const key of ['holder', 'participant']) {
    const v = out[key];
    if (v && typeof v === 'object') {
      const { photoPath: _drop, ...rest } = v as Record<string, unknown>;
      void _drop;
      out[key] = rest;
    }
  }
  return out;
}

export type TagsApi = ReturnType<typeof createTagsApi>;
