import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { PHOTO_BUCKET } from '@/lib/storage/photos';

type Db = SupabaseClient<Database>;
export const RETENTION_DAYS = 30;

export interface RetentionReport {
  events: Array<{ eventId: string; participants: number; photos: number }>;
  /** PLAN F26.3: events past ends_at + profile_retention_days where something was removed. */
  profiles: Array<{ eventId: string; profiles: number; keys: number; sessions: number; codes: number; taps: number }>;
}

const profileCounts = z.object({ code: z.literal('RETAINED'), profiles: z.number(), keys: z.number(), sessions: z.number(), codes: z.number(), taps: z.number() });

// SPEC §15: 30 days after an event ends, delete its photos (storage objects too), dietary notes and
// accessibility/health notes (profiles 2026-10-13).
// Storage first, then the rows, so a crash in between is repaired by the next run (removing a
// missing object is not an error). Idempotent: already-cleared rows are not selected again.
export async function runRetention(db: Db, now: Date): Promise<RetentionReport> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  const { data: events, error } = await db.from('events').select('id').lte('ends_at', cutoff);
  if (error) throw new Error(`retention events load failed (${error.code})`);

  const report: RetentionReport = { events: [], profiles: await retainProfiles(db, now) };
  for (const { id: eventId } of events) {
    const { data: people, error: peopleError } = await db
      .from('participants')
      .select('id, photo_path')
      .eq('event_id', eventId)
      .or('photo_path.not.is.null,dietary_notes.not.is.null,accessibility_notes.not.is.null');
    if (peopleError) throw new Error(`retention participants load failed (${peopleError.code})`);
    if (people.length === 0) continue;

    const paths = people.flatMap((p) => (p.photo_path ? [p.photo_path] : []));
    for (let i = 0; i < paths.length; i += 500) {
      const { error: removeError } = await db.storage.from(PHOTO_BUCKET).remove(paths.slice(i, i + 500));
      if (removeError) throw new Error(`retention photo removal failed (${removeError.name})`);
    }
    const ids = people.map((p) => p.id);
    for (let i = 0; i < ids.length; i += 500) {
      const { error: updateError } = await db
        .from('participants')
        .update({ photo_path: null, photo_updated_at: null, dietary_notes: null, accessibility_notes: null, updated_at: now.toISOString() })
        .in('id', ids.slice(i, i + 500));
      if (updateError) throw new Error(`retention update failed (${updateError.code})`);
    }
    // Counts only (I-11).
    const { error: auditError } = await db
      .from('audit_log')
      .insert({ event_id: eventId, actor_kind: 'system', action: 'privacy.retention', detail: { participants: ids.length, photos: paths.length } });
    if (auditError) throw new Error(`audit_log insert failed (${auditError.code})`);
    report.events.push({ eventId, participants: ids.length, photos: paths.length });
  }
  return report;
}

// PLAN F26.3, per event's own profile_retention_days (≥ 1). retain_event_profiles re-checks the date in
// SQL and is idempotent, so candidates only need to be roughly right.
async function retainProfiles(db: Db, now: Date): Promise<RetentionReport['profiles']> {
  const { data: events, error } = await db
    .from('events')
    .select('id, ends_at, profile_retention_days')
    .lte('ends_at', new Date(now.getTime() - 86_400_000).toISOString());
  if (error) throw new Error(`retention events load failed (${error.code})`);
  const out: RetentionReport['profiles'] = [];
  for (const e of events) {
    if (new Date(e.ends_at).getTime() + e.profile_retention_days * 86_400_000 > now.getTime()) continue;
    const { data, error: rpcError } = await db.rpc('retain_event_profiles', { p_event_id: e.id });
    if (rpcError) throw new Error(`retain_event_profiles failed (${rpcError.code})`);
    const r = profileCounts.safeParse(data);
    if (r.success && r.data.profiles + r.data.keys + r.data.sessions + r.data.codes + r.data.taps > 0) {
      const { profiles, keys, sessions, codes, taps } = r.data;
      out.push({ eventId: e.id, profiles, keys, sessions, codes, taps });
    }
  }
  return out;
}
