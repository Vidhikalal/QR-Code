import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { LINK_CODES, type LinkCode } from '@/lib/domain/badge';
import { normalizeEmail } from '@/lib/domain/normalize';
import { parseProfileInput, type ProfileFields, type ProfileInput } from '@/lib/domain/profile';

type Account = { id: string; email?: string | null };

export interface MyBadgeProfile {
  participantId: string;
  eventId: string;
  eventName: string;
  linkedinUrl: string | null;
  profilePublic: boolean;
  badge: boolean;
}

// Badge profiles stay up until 30 days after the event (§6.5); the same window as badge_profile().
const PROFILE_WINDOW_MS = 30 * 24 * 3600 * 1000;

// SPEC §6.5 (v0.5): the signed-in attendee's badge profiles (matched by verified email), one per accepted
// event. These are also the events they can claim a badge in.
export async function myBadgeProfiles(db: SupabaseClient<Database>, email: string, now: Date): Promise<MyBadgeProfile[]> {
  const { data, error } = await db
    .from('participants')
    .select('id, linkedin_url, profile_public, events!inner(id, name, starts_at, ends_at), badges(uid)')
    .eq('email', normalizeEmail(email))
    .eq('status', 'accepted')
    .is('deleted_at', null)
    .gt('events.ends_at', new Date(now.getTime() - PROFILE_WINDOW_MS).toISOString());
  if (error) throw new Error(`badge profiles lookup failed (${error.code})`);
  return data
    .toSorted((a, b) => a.events.starts_at.localeCompare(b.events.starts_at))
    .map((p) => ({
      participantId: p.id,
      eventId: p.events.id,
      eventName: p.events.name,
      linkedinUrl: p.linkedin_url,
      profilePublic: p.profile_public,
      badge: p.badges.length > 0,
    }));
}

export interface MyEvent {
  participantId: string;
  firstName: string;
  lastName: string;
  slug: string;
  badge: boolean;
  linkedinUrl: string | null;
  profilePublic: boolean;
  dietaryNotes: string | null;
  emergency: { name: string; phone: string; relation: string | null } | null;
  event: { name: string; venue: string; startsAt: string; timezone: string; schedule: string; emergencyInfo: string };
}

// SPEC F14 (v0.6.1): the hacker menu's event for the signed-in accepted attendee (verified email): the next one
// that hasn't ended, else the most recent, up to 30 days after it ends; null for anyone else.
// shortcut: with two events not yet over, only the earlier one shows; add an event picker if the club runs overlapping events.
// Their own emergency contact is in here: never pass it to someone else.
export async function myEvent(db: SupabaseClient<Database>, email: string, now: Date): Promise<MyEvent | null> {
  const { data, error } = await db
    .from('participants')
    .select(
      'id, first_name, last_name, linkedin_url, profile_public, dietary_notes, emergency_name, emergency_phone, emergency_relation, events!inner(slug, name, venue, starts_at, ends_at, timezone, schedule, emergency_info), badges(uid)',
    )
    .eq('email', normalizeEmail(email))
    .eq('status', 'accepted')
    .is('deleted_at', null)
    .gt('events.ends_at', new Date(now.getTime() - PROFILE_WINDOW_MS).toISOString());
  if (error) throw new Error(`my event lookup failed (${error.code})`);
  // Date.parse, not string order: Postgres answers "+00:00" where toISOString() says "Z".
  const byStart = data.toSorted((a, b) => Date.parse(a.events.starts_at) - Date.parse(b.events.starts_at));
  const p = byStart.find((x) => Date.parse(x.events.ends_at) > now.getTime()) ?? byStart.at(-1);
  if (!p) return null;
  const e = p.events;
  return {
    participantId: p.id,
    firstName: p.first_name,
    lastName: p.last_name,
    slug: e.slug,
    badge: p.badges.length > 0,
    linkedinUrl: p.linkedin_url,
    profilePublic: p.profile_public,
    dietaryNotes: p.dietary_notes,
    emergency: p.emergency_name && p.emergency_phone ? { name: p.emergency_name, phone: p.emergency_phone, relation: p.emergency_relation } : null,
    event: { name: e.name, venue: e.venue, startsAt: e.starts_at, timezone: e.timezone, schedule: e.schedule, emergencyInfo: e.emergency_info },
  };
}

// Arguments for save_hacker_profile() and rsvp_respond(); a missing key leaves that column unchanged.
export function profileArgs(v: ProfileFields) {
  return {
    p_linkedin_url: v.linkedinUrl,
    p_public: v.profilePublic,
    p_dietary_notes: v.dietaryNotes,
    p_emergency_name: v.emergency?.name,
    p_emergency_phone: v.emergency?.phone,
    p_emergency_relation: v.emergency?.relation,
  };
}

export type SaveProfileResult = 'SAVED' | 'INVALID_LINKEDIN' | 'INVALID_DIETARY' | 'INVALID_CONTACT' | 'NOT_FOUND';

// /me/profile and /me/emergency: the attendee's own LinkedIn, sharing, dietary notes and emergency contact.
// save_hacker_profile() only touches the row whose email is the account's (a forged id changes nothing).
export async function saveBadgeProfile(
  db: SupabaseClient<Database>,
  user: Account,
  participantId: string,
  input: ProfileInput,
): Promise<SaveProfileResult> {
  const parsed = parseProfileInput(input, { requireEmergency: false });
  if (!parsed.ok) {
    return parsed.field === 'linkedin' ? 'INVALID_LINKEDIN' : parsed.field === 'dietaryNotes' ? 'INVALID_DIETARY' : 'INVALID_CONTACT';
  }
  if (!user.email || !z.uuid().safeParse(participantId).success) return 'NOT_FOUND';
  const { data, error } = await db.rpc('save_hacker_profile', {
    p_participant_id: participantId,
    p_email: normalizeEmail(user.email),
    p_user_id: user.id,
    ...profileArgs(parsed.value),
  });
  if (error) throw new Error(`save_hacker_profile failed (${error.code})`);
  return data ? 'SAVED' : 'NOT_FOUND';
}

// /profile/<uid> "This is my badge" (§6.5, v0.5): links an unlinked badge to the signed-in attendee.
export async function claimBadge(db: SupabaseClient<Database>, user: Account, uid: string, eventId: string): Promise<LinkCode> {
  if (!user.email || !z.uuid().safeParse(eventId).success) return 'NOT_FOUND';
  const { data, error } = await db.rpc('claim_badge', {
    p_uid: uid,
    p_event_id: eventId,
    p_email: normalizeEmail(user.email),
    p_user_id: user.id,
  });
  if (error) throw new Error(`claim_badge failed (${error.code})`);
  return z.enum(LINK_CODES).parse(data);
}
