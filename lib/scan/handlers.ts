import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Authenticate } from '@/lib/auth/session';
import { requireStaffBySlug } from '@/lib/auth/staff';
import { staffNames } from '@/lib/db/staff-names';
import type { Database } from '@/lib/db/types.gen';
import { BADGE_UID_RE, LINK_CODES } from '@/lib/domain/badge';
import { maskEmail } from '@/lib/domain/mask';
import { sanitizeError } from '@/lib/domain/outbox';
import { SCAN_CODES, VOID_CODES } from '@/lib/domain/scan-codes';
import { searchQuery } from '@/lib/domain/search';
import { sha256hex } from '@/lib/domain/token';
import { UNDO_WINDOW_MS } from '@/lib/scanner/undo';
import { signedPhotoUrl, signedPhotoUrls } from '@/lib/storage/photos';
import { scanRequestSchema } from './schema';

type Db = SupabaseClient<Database>;
type RecordScanArgs = Database['public']['Functions']['record_scan']['Args'];

export interface ApiDeps {
  db: Db;
  authenticate: Authenticate;
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const unauthorized = () => json({ error: 'unauthorized' }, 401);
const forbidden = () => json({ error: 'forbidden' }, 403);
const badRequest = () => json({ error: 'invalid_request' }, 400);
const notFound = () => json({ error: 'not_found' }, 404);

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

// §15 limits, counted over a sliding window from scan_attempts (which logs every scan) so there are
// no window-boundary effects. Postgres-backed: serverless instances share no memory.
const SCANS_PER_MINUTE = 120;
const NOT_FOUND_PER_5_MIN = 30;

async function recentAttempts(db: Db, staffId: string, seconds: number, code?: string): Promise<number> {
  let q = db
    .from('scan_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('staff_user_id', staffId)
    .gte('created_at', new Date(Date.now() - seconds * 1000).toISOString());
  if (code) q = q.eq('result_code', code);
  const { count, error } = await q;
  if (error) throw new Error(`scan_attempts count failed (${error.code})`);
  return count ?? 0;
}

// record_scan() answers a replay before it checks that the caller is still staff (§8 step 1), so health data
// on a replay goes only to current staff of the scan's event (v0.9).
async function staffOfScan(db: Db, scanId: string | undefined, userId: string): Promise<boolean> {
  if (!scanId) return false;
  const { data: scan, error } = await db.from('scans').select('event_id').eq('id', scanId).maybeSingle();
  if (error) throw new Error(`scan load failed (${error.code})`);
  if (!scan) return false;
  const { data: staff, error: staffError } = await db.from('event_staff').select('user_id').eq('event_id', scan.event_id).eq('user_id', userId).maybeSingle();
  if (staffError) throw new Error(`event_staff load failed (${staffError.code})`);
  return staff !== null;
}

const participantSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  photoPath: z.string().nullable(),
  status: z.string(),
  dietaryNotes: z.string().nullable().optional(),
  allergies: z.string().nullable().optional(),
  allergySeverity: z.string().nullable().optional(),
});
const scanResultSchema = z.object({
  code: z.enum(SCAN_CODES),
  replayed: z.boolean().optional(),
  voided: z.boolean().optional(),
  scanId: z.string().optional(),
  participant: participantSchema.optional(),
  previous: z.object({ scannedAt: z.string(), scannedByName: z.string().nullable(), scannedByMe: z.boolean() }).optional(),
  reissued: z.boolean().optional(),
  revokeReason: z.string().nullable().optional(),
  otherEvent: z.string().nullable().optional(),
  capacity: z.number().optional(),
});

// POST /api/scan (SPEC §9.1, F6). Every decision is made by record_scan() (I-2); this handler only
// authenticates, rate-limits, hashes the token (I-3), signs the photo URL and logs the attempt.
export function createScanHandler(deps: ApiDeps) {
  return async (request: Request): Promise<Response> => {
    const user = await deps.authenticate(request);
    if (!user) return unauthorized();
    const parsed = scanRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return badRequest();
    const body = parsed.data;

    const [recent, notFound, checkpoint] = await Promise.all([
      recentAttempts(deps.db, user.id, 60),
      recentAttempts(deps.db, user.id, 300, 'NOT_FOUND'),
      deps.db.from('checkpoints').select('event_id').eq('id', body.checkpointId).maybeSingle(),
    ]);
    if (recent >= SCANS_PER_MINUTE || notFound >= NOT_FOUND_PER_5_MIN) return json({ error: 'rate_limited' }, 429);

    const started = performance.now();
    // Generated types mark every argument without a default as non-null, but record_scan takes NULL
    // for whichever of token hash / participant id the method doesn't use (SPEC §8).
    const { data, error } =
      body.badgeUid !== undefined
        ? // NFC (§8 note): record_badge_scan resolves the badge, then calls record_scan in the same transaction.
          await deps.db.rpc('record_badge_scan', {
            p_checkpoint_id: body.checkpointId,
            p_staff_user_id: user.id,
            p_badge_uid: body.badgeUid,
            p_client_scan_id: body.clientScanId,
            p_client_scanned_at: body.clientScannedAt,
          })
        : await deps.db.rpc('record_scan', {
            p_checkpoint_id: body.checkpointId,
            p_staff_user_id: user.id,
            p_method: body.method,
            p_token_hash: body.token !== undefined ? sha256hex(body.token) : null,
            p_participant_id: body.participantId ?? null,
            p_client_scan_id: body.clientScanId,
            p_client_scanned_at: body.clientScannedAt,
          } as RecordScanArgs);
    if (error) throw new Error(`record_scan failed (${error.code})`);
    const result = scanResultSchema.parse(data);
    const latencyMs = Math.round(performance.now() - started);

    // ids, code and latency only (I-11). A logging failure must not turn a recorded scan into an error.
    const { error: logError } = await deps.db.from('scan_attempts').insert({
      event_id: checkpoint.data?.event_id ?? null,
      checkpoint_id: checkpoint.data ? body.checkpointId : null,
      staff_user_id: user.id,
      participant_id: result.participant?.id ?? null,
      result_code: result.code,
      latency_ms: latencyMs,
    });
    if (logError) console.error(JSON.stringify({ level: 'error', msg: 'scan_attempts insert failed', error: sanitizeError(logError.code) }));

    const { participant, ...rest } = result;
    const health = rest.code === 'ACCEPTED' && (!rest.replayed || (await staffOfScan(deps.db, rest.scanId, user.id)));
    return json({
      ...rest,
      ...(participant && {
        participant: {
          id: participant.id,
          displayName: participant.displayName,
          status: participant.status,
          // v0.9: dietary notes and allergies only on ACCEPTED (record_scan() answers REVOKED before it checks
          // the event, so another event's attendee would otherwise show theirs here), and a replay only to current staff.
          dietaryNotes: health ? (participant.dietaryNotes ?? null) : null,
          ...(health && { allergies: participant.allergies ?? null, allergySeverity: participant.allergySeverity ?? null }),
          photoUrl: participant.photoPath ? await signedPhotoUrl(deps.db, participant.photoPath) : null,
        },
      }),
      serverTime: new Date().toISOString(),
    });
  };
}

// GET /api/events/[slug]/checkpoints: the scanner's checkpoint picker.
export function createCheckpointsHandler(deps: ApiDeps) {
  return async (request: Request, params: { slug: string }): Promise<Response> => {
    const user = await deps.authenticate(request);
    if (!user) return unauthorized();
    const staff = await requireStaffBySlug(deps.db, user.id, params.slug);
    if (!staff) return forbidden();
    const { data, error } = await deps.db
      .from('checkpoints')
      .select('id, name, kind, is_open, requires_checkin, capacity, sort_order')
      .eq('event_id', staff.eventId)
      .order('sort_order')
      .order('name');
    if (error) throw new Error(`checkpoints load failed (${error.code})`);
    return json({
      role: staff.role,
      checkpoints: data.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        isOpen: c.is_open,
        requiresCheckin: c.requires_checkin,
        capacity: c.capacity,
      })),
    });
  };
}

// GET /api/events/[slug]/checkpoints/[id]/scans (SPEC §10.6, §11, v0.8): who was scanned here, for the
// event's staff (names only, no emails). canRemove only decides whether to offer Remove: void_scan() is the
// authority (F11: organizers any scan, volunteers their own within 120 s).
export function createCheckpointScansHandler(deps: ApiDeps) {
  return async (request: Request, params: { slug: string; id: string }): Promise<Response> => {
    const user = await deps.authenticate(request);
    if (!user) return unauthorized();
    const staff = await requireStaffBySlug(deps.db, user.id, params.slug);
    if (!staff) return forbidden();
    const id = z.uuid().safeParse(params.id);
    if (!id.success) return notFound();
    const { data: cp, error: cpError } = await deps.db.from('checkpoints').select('id').eq('id', id.data).eq('event_id', staff.eventId).maybeSingle();
    if (cpError) throw new Error(`checkpoint lookup failed (${cpError.code})`);
    if (!cp) return notFound();
    // shortcut: newest 1000 only; paginate if a checkpoint ever sees more people than that.
    const { data, error } = await deps.db
      .from('scans')
      .select('id, scanned_at, method, scanned_by, participants!inner(first_name, last_name, is_test)')
      .eq('checkpoint_id', cp.id)
      .is('voided_at', null)
      .is('participants.deleted_at', null) // deleted people drop off, like every count (§5.1, §13)
      .order('scanned_at', { ascending: false })
      .limit(1000);
    if (error) throw new Error(`checkpoint scans load failed (${error.code})`);
    const names = await staffNames(deps.db, data.map((s) => s.scanned_by));
    const now = Date.now();
    return json({
      role: staff.role,
      scans: data.map((s) => ({
        id: s.id,
        displayName: `${s.participants.first_name} ${s.participants.last_name}`.trim(),
        isTest: s.participants.is_test,
        scannedAt: s.scanned_at,
        method: s.method,
        scannedByName: names.get(s.scanned_by) ?? null,
        canRemove: staff.role === 'organizer' || (s.scanned_by === user.id && now - Date.parse(s.scanned_at) < UNDO_WINDOW_MS),
      })),
    });
  };
}

const linkBody = z.object({ participantId: z.uuid(), uid: z.string().regex(BADGE_UID_RE) }).strict();

// POST /api/events/[slug]/badges (SPEC §6.5). Any staff member of the event may link an unlinked
// badge; only an organizer's link moves a badge that belongs to someone else. Rules live in link_badge().
export function createBadgeLinkHandler(deps: ApiDeps) {
  return async (request: Request, params: { slug: string }): Promise<Response> => {
    const user = await deps.authenticate(request);
    if (!user) return unauthorized();
    const staff = await requireStaffBySlug(deps.db, user.id, params.slug);
    if (!staff) return forbidden();
    const body = linkBody.safeParse(await readJson(request));
    if (!body.success) return badRequest();
    const { data, error } = await deps.db.rpc('link_badge', {
      p_event_id: staff.eventId,
      p_participant_id: body.data.participantId,
      p_uid: body.data.uid,
      p_actor: user.id,
      p_move: staff.role === 'organizer',
    });
    if (error) throw new Error(`link_badge failed (${error.code})`);
    return json({ code: z.enum(LINK_CODES).parse(data) });
  };
}

// GET /api/events/[slug]/participants/search?q=&checkpointId= (SPEC §10.4).
export function createSearchHandler(deps: ApiDeps) {
  return async (request: Request, params: { slug: string }): Promise<Response> => {
    const user = await deps.authenticate(request);
    if (!user) return unauthorized();
    const staff = await requireStaffBySlug(deps.db, user.id, params.slug);
    if (!staff) return forbidden();

    const url = new URL(request.url);
    const q = searchQuery(url.searchParams.get('q') ?? '');
    const checkpointParam = url.searchParams.get('checkpointId');
    const checkpointId = checkpointParam === null ? undefined : z.uuid().safeParse(checkpointParam).data;
    if (q === null || (checkpointParam !== null && checkpointId === undefined)) return badRequest();

    const { data, error } = await deps.db.rpc('search_participants', {
      p_event_id: staff.eventId,
      p_query: q,
      ...(checkpointId && { p_checkpoint_id: checkpointId }),
    });
    if (error) throw new Error(`search failed (${error.code})`);
    const photos = await signedPhotoUrls(deps.db, data.flatMap((r) => (r.photo_path ? [r.photo_path] : [])));
    return json({
      results: data.map((r) => ({
        id: r.id,
        displayName: `${r.first_name} ${r.last_name}`.trim(),
        status: r.status,
        email: staff.role === 'organizer' ? r.email : maskEmail(r.email),
        photoUrl: r.photo_path ? (photos.get(r.photo_path) ?? null) : null,
        scannedHere: r.scanned_here,
      })),
    });
  };
}

const voidBody = z.object({ reason: z.string().trim().min(3).max(200) }).strict();
const voidResultSchema = z.object({ code: z.enum(VOID_CODES) });

// POST /api/scans/[id]/void (SPEC F11). The 120 s / own-scan rules live in void_scan().
export function createVoidHandler(deps: ApiDeps) {
  return async (request: Request, params: { id: string }): Promise<Response> => {
    const user = await deps.authenticate(request);
    if (!user) return unauthorized();
    const id = z.uuid().safeParse(params.id);
    const body = voidBody.safeParse(await readJson(request));
    if (!id.success || !body.success) return badRequest();
    const { data, error } = await deps.db.rpc('void_scan', {
      p_scan_id: id.data,
      p_staff_user_id: user.id,
      p_reason: body.data.reason,
    });
    if (error) throw new Error(`void_scan failed (${error.code})`);
    return json(voidResultSchema.parse(data));
  };
}
