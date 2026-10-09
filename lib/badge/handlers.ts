import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Authenticate } from '@/lib/auth/session';
import { requireStaffBySlug } from '@/lib/auth/staff';
import type { Database } from '@/lib/db/types.gen';
import { readParticipant } from '@/lib/participant/handlers';
import { profileFields } from '@/lib/profile/load';
import type { BadgeRole } from '@/lib/profile/schema';
import { signedPhotoUrl } from '@/lib/storage/photos';
import { isPublicId } from './tags';
import { badgeView, type BadgeInput, type BadgeView, type Involvement, type StaffExtras, type StationCheckpoint, type Viewer } from './view';

type Db = SupabaseClient<Database>;

const SUGGESTION_WINDOW_MS = 2 * 60 * 1000;

const tagViewSchema = z.object({
  tag: z.object({ id: z.string(), eventId: z.string(), label: z.string().nullable(), retiredAt: z.string().nullable() }),
  event: z.object({ slug: z.string(), name: z.string(), endsAt: z.string(), retentionDays: z.number() }),
  assignment: z.object({ id: z.string(), participantId: z.string(), assignedAt: z.string(), assignedBy: z.string() }).nullable(),
  lastHolderId: z.string().nullable(),
});

// PLAN §8.1: who is looking? Staff of THIS badge's event (Supabase session), else a participant
// (pl_me cookie), else anonymous. A badge id never decides it (I-16).
async function resolveViewer(db: Db, request: Request, authenticate: Authenticate, meOrigin: string, event: { id: string; slug: string }): Promise<Viewer> {
  const user = await authenticate(request);
  if (user) {
    const staff = await requireStaffBySlug(db, user.id, event.slug);
    if (staff) {
      const { data: own } = await db.from('participants').select('id').eq('event_id', event.id).eq('staff_user_id', user.id).is('deleted_at', null).maybeSingle();
      return { kind: 'staff', userId: user.id, eventId: event.id, role: staff.role, ...(own && { participantId: own.id }) };
    }
  }
  const who = await readParticipant(db, request, meOrigin);
  if (!who) return { kind: 'anonymous' };
  const { data, error } = await db.from('participants').select('event_id').eq('id', who.participantId).single();
  if (error) throw new Error(`participant load failed (${error.code})`);
  return { kind: 'participant', participantId: who.participantId, eventId: data.event_id };
}

async function activeLabel(db: Db, participantId: string): Promise<string | null> {
  const { data, error } = await db.from('tag_assignments').select('tags(label)').eq('participant_id', participantId).is('ended_at', null).maybeSingle();
  if (error) throw new Error(`assignment load failed (${error.code})`);
  return data?.tags.label ?? null;
}

// F20: the latest person this staff member admitted at the door in the last 2 minutes who has no badge.
async function suggestion(db: Db, userId: string, eventId: string, now: Date): Promise<StaffExtras['suggestion']> {
  const since = new Date(now.getTime() - SUGGESTION_WINDOW_MS).toISOString();
  const { data, error } = await db
    .from('scans')
    .select('participant_id, scanned_at, participants(first_name, last_name), checkpoints!inner(kind)')
    .eq('event_id', eventId)
    .eq('scanned_by', userId)
    .eq('checkpoints.kind', 'door')
    .is('voided_at', null)
    .gte('scanned_at', since)
    .order('scanned_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(`recent admissions load failed (${error.code})`);
  if (data.length === 0) return null;
  const { data: linked, error: linkError } = await db
    .from('tag_assignments')
    .select('participant_id')
    .in('participant_id', data.map((s) => s.participant_id))
    .is('ended_at', null);
  if (linkError) throw new Error(`assignment load failed (${linkError.code})`);
  const taken = new Set(linked.map((l) => l.participant_id));
  const s = data.find((x) => !taken.has(x.participant_id));
  return s ? { participantId: s.participant_id, name: `${s.participants.first_name} ${s.participants.last_name}`.trim(), admittedAt: s.scanned_at } : null;
}

// V5b: the checkpoint this staff member is working (saved by the scanner's picker, PLAN §6.6).
async function stationOf(db: Db, userId: string, eventId: string): Promise<StationCheckpoint | null> {
  const { data, error } = await db.from('staff_stations').select('checkpoints(id, name, kind)').eq('user_id', userId).eq('event_id', eventId).maybeSingle();
  if (error) throw new Error(`station load failed (${error.code})`);
  return data ? { checkpointId: data.checkpoints.id, name: data.checkpoints.name, kind: data.checkpoints.kind } : null;
}

async function openCheckpoints(db: Db, eventId: string): Promise<StationCheckpoint[]> {
  const { data, error } = await db.from('checkpoints').select('id, name, kind').eq('event_id', eventId).eq('is_open', true).order('sort_order').order('name');
  if (error) throw new Error(`checkpoints load failed (${error.code})`);
  return data.map((c) => ({ checkpointId: c.id, name: c.name, kind: c.kind }));
}

async function involvementOf(db: Db, participantId: string): Promise<Involvement | null> {
  const { data, error } = await db.rpc('holder_involvement', { p_participant_id: participantId });
  if (error) throw new Error(`holder_involvement failed (${error.code})`);
  return data as unknown as Involvement | null;
}

// PLAN F24: is the request signed in as a participant of this event (other than the holder)? If so,
// where does their connection with the holder stand? Organizers who used My badge profile qualify too.
async function connectionWith(db: Db, request: Request, meOrigin: string, eventId: string, holderId: string): Promise<'none' | 'pending' | 'mutual' | undefined> {
  const who = await readParticipant(db, request, meOrigin);
  if (!who || who.participantId === holderId) return undefined;
  const { data: me, error } = await db.from('participants').select('event_id').eq('id', who.participantId).single();
  if (error) throw new Error(`participant load failed (${error.code})`);
  if (me.event_id !== eventId) return undefined;
  const { data: taps, error: tapError } = await db
    .from('connection_taps')
    .select('from_participant_id')
    .or(`and(from_participant_id.eq.${who.participantId},to_participant_id.eq.${holderId}),and(from_participant_id.eq.${holderId},to_participant_id.eq.${who.participantId})`);
  if (tapError) throw new Error(`connection load failed (${tapError.code})`);
  const mine = taps.some((t) => t.from_participant_id === who.participantId);
  const theirs = taps.some((t) => t.from_participant_id === holderId);
  return mine && theirs ? 'mutual' : mine ? 'pending' : 'none';
}

/** Everything /t/<publicId> renders. Reads only (I-17; the session's last_seen_at refresh is allowed). */
export async function loadBadgePage(deps: {
  db: Db;
  publicId: string;
  request: Request;
  authenticate: Authenticate;
  meOrigin: string;
  extraRoles: boolean;
  now: Date;
}): Promise<BadgeView> {
  const { db, now } = deps;
  if (!isPublicId(deps.publicId)) return { kind: 'not_found' };
  const { data: raw, error } = await db.rpc('tag_view', { p_public_id: deps.publicId });
  if (error) throw new Error(`tag_view failed (${error.code})`);
  if (raw === null) return { kind: 'not_found' };
  const tv = tagViewSchema.parse(raw);
  const event = { id: tv.tag.eventId, ...tv.event };
  const viewer = await resolveViewer(db, deps.request, deps.authenticate, deps.meOrigin, event);

  let holder: BadgeInput['holder'] = null;
  let holderRow: { status: string; photo_path: string | null; first_name: string; last_name: string; badge_role: string } | null = null;
  if (tv.assignment) {
    const { data, error: holderError } = await db
      .from('participants')
      .select('id, first_name, last_name, badge_role, status, photo_path, profiles(*)')
      .eq('id', tv.assignment.participantId)
      .single();
    if (holderError) throw new Error(`holder load failed (${holderError.code})`);
    holderRow = data;
    holder = { participantId: data.id, firstName: data.first_name, lastName: data.last_name, badgeRole: data.badge_role as BadgeRole, fields: profileFields(data.profiles) };
  }

  let lastHolder: BadgeInput['lastHolder'] = null;
  if (tv.tag.retiredAt && tv.lastHolderId) {
    const { data, error: lastError } = await db.from('participants').select('id, first_name, last_name').eq('id', tv.lastHolderId).single();
    if (lastError) throw new Error(`last holder load failed (${lastError.code})`);
    lastHolder = { participantId: data.id, name: `${data.first_name} ${data.last_name}`.trim(), currentLabel: await activeLabel(db, data.id) };
  }

  let staffExtras: StaffExtras | undefined;
  if (viewer.kind === 'staff') {
    const linked = tv.assignment !== null;
    const [station, checkpoints, involvement] = linked
      ? await Promise.all([stationOf(db, viewer.userId, event.id), openCheckpoints(db, event.id), involvementOf(db, tv.assignment?.participantId ?? '')])
      : [null, [], null];
    staffExtras = {
      station,
      checkpoints,
      involvement,
      holder: holderRow && {
        fullName: `${holderRow.first_name} ${holderRow.last_name}`.trim(),
        badgeRole: holderRow.badge_role,
        status: holderRow.status,
        photoUrl: holderRow.photo_path ? await signedPhotoUrl(db, holderRow.photo_path) : null,
      },
      suggestion: tv.assignment || tv.tag.retiredAt ? null : await suggestion(db, viewer.userId, event.id, now),
    };
  }

  const connection = tv.assignment && !tv.tag.retiredAt ? await connectionWith(db, deps.request, deps.meOrigin, event.id, tv.assignment.participantId) : undefined;
  const { data: ev, error: evError } = await db.from('events').select('timezone').eq('id', event.id).single();
  if (evError) throw new Error(`event load failed (${evError.code})`);
  return badgeView({
    event: { ...event, timezone: ev.timezone },
    tag: { id: tv.tag.id, label: tv.tag.label, retiredAt: tv.tag.retiredAt, publicId: deps.publicId },
    assignment: tv.assignment,
    holder,
    lastHolder,
    viewer,
    extraRoles: deps.extraRoles,
    now,
    ...(staffExtras && { staffExtras }),
    ...(connection !== undefined && { connection }),
  });
}
