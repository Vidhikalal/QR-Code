import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { toPublicProfile, type ProfileFields, type PublicProfile } from './public';
import type { BadgeRole } from './schema';

type Db = SupabaseClient<Database>;
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export function profileFields(row: ProfileRow | null): ProfileFields | null {
  if (!row) return null;
  return {
    nickname: row.nickname,
    pronouns: row.pronouns,
    program: row.program,
    yearLabel: row.year_label,
    bio: row.bio,
    linkedinUrl: row.linkedin_url,
    githubUrl: row.github_url,
    websiteUrl: row.website_url,
    discordHandle: row.discord_handle,
    askMeAbout: row.ask_me_about,
    visibility: row.visibility === 'hidden' ? 'hidden' : 'public',
    hiddenByStaffAt: row.hidden_by_staff_at,
  };
}

export interface LoadedProfile {
  participantId: string;
  eventId: string;
  badgeRole: BadgeRole;
  fields: ProfileFields | null;
  public: PublicProfile;
}

/** One participant's profile and its public shape (I-19). Scoped to an event when `eventId` is given. */
export async function loadProfile(db: Db, participantId: string, opts: { extraRoles: boolean; eventId?: string }): Promise<LoadedProfile | null> {
  let q = db
    .from('participants')
    .select('id, event_id, first_name, last_name, badge_role, events(name), profiles(*)')
    .eq('id', participantId)
    .is('deleted_at', null);
  if (opts.eventId) q = q.eq('event_id', opts.eventId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`profile load failed (${error.code})`);
  if (!data) return null;
  const badgeRole = data.badge_role as BadgeRole;
  const fields = profileFields(data.profiles);
  return {
    participantId: data.id,
    eventId: data.event_id,
    badgeRole,
    fields,
    public: toPublicProfile({
      participant: { firstName: data.first_name, lastName: data.last_name, badgeRole },
      profile: fields,
      eventName: data.events.name,
      extraRoles: opts.extraRoles,
    }),
  };
}
