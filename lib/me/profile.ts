import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { LINK_CODES, normalizeLinkedIn, type LinkCode } from '@/lib/domain/badge';
import { normalizeEmail } from '@/lib/domain/normalize';

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

export type SaveProfileResult = 'SAVED' | 'INVALID_LINKEDIN' | 'NOT_FOUND';

// /me: an attendee sets their own LinkedIn (blank clears it) and whether their badge shows it.
// save_badge_profile() only touches the row whose email is the account's (a forged id changes nothing).
export async function saveBadgeProfile(
  db: SupabaseClient<Database>,
  user: Account,
  participantId: string,
  input: { linkedin: string; profilePublic: boolean },
): Promise<SaveProfileResult> {
  const linkedin = input.linkedin.trim() === '' ? '' : normalizeLinkedIn(input.linkedin);
  if (linkedin === null) return 'INVALID_LINKEDIN';
  if (!user.email || !z.uuid().safeParse(participantId).success) return 'NOT_FOUND';
  const { data, error } = await db.rpc('save_badge_profile', {
    p_participant_id: participantId,
    p_email: normalizeEmail(user.email),
    p_linkedin_url: linkedin,
    p_public: input.profilePublic,
    p_user_id: user.id,
  });
  if (error) throw new Error(`save_badge_profile failed (${error.code})`);
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
