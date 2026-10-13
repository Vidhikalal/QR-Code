import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { toPublicProfile, type ProfileFields, type PublicProfile } from './public';
import { DEFAULT_PUBLIC_FIELDS, PUBLIC_FIELDS, type BadgeRole, type PublicField } from './schema';

type Db = SupabaseClient<Database>;
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
/** The participant-row columns a profile shows (shared with meal check-ins and retention). */
export type ProfileNotes = { dietary_notes: string | null; accessibility_notes: string | null };

const asPublicFields = (xs: string[]): PublicField[] => xs.filter((x): x is PublicField => (PUBLIC_FIELDS as readonly string[]).includes(x));

/** Fields for toPublicProfile: the profile row (null before the first edit) plus the participant's notes. */
export function profileFields(row: ProfileRow | null, notes: ProfileNotes): ProfileFields {
  if (!row) {
    return {
      nickname: null,
      pronouns: null,
      program: null,
      yearLabel: null,
      bio: null,
      linkedinUrl: null,
      githubUrl: null,
      websiteUrl: null,
      discordHandle: null,
      skills: [],
      lookingFor: [],
      dietaryNotes: notes.dietary_notes,
      accessibilityNotes: notes.accessibility_notes,
      publicFields: [...DEFAULT_PUBLIC_FIELDS],
      visibility: 'public',
      hiddenByStaffAt: null,
    };
  }
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
    skills: row.ask_me_about,
    lookingFor: row.looking_for,
    dietaryNotes: notes.dietary_notes,
    accessibilityNotes: notes.accessibility_notes,
    publicFields: asPublicFields(row.public_fields),
    visibility: row.visibility === 'hidden' ? 'hidden' : 'public',
    hiddenByStaffAt: row.hidden_by_staff_at,
  };
}

export interface LoadedProfile {
  participantId: string;
  eventId: string;
  badgeRole: BadgeRole;
  fields: ProfileFields;
  public: PublicProfile;
  /** Every field, for organizers and volunteers of the event. */
  staffView: PublicProfile;
}

/** One participant's profile and its public shape (I-19). Scoped to an event when `eventId` is given. */
export async function loadProfile(db: Db, participantId: string, opts: { extraRoles: boolean; eventId?: string }): Promise<LoadedProfile | null> {
  let q = db
    .from('participants')
    .select('id, event_id, first_name, last_name, badge_role, dietary_notes, accessibility_notes, events(name), profiles(*)')
    .eq('id', participantId)
    .is('deleted_at', null);
  if (opts.eventId) q = q.eq('event_id', opts.eventId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`profile load failed (${error.code})`);
  if (!data) return null;
  const badgeRole = data.badge_role as BadgeRole;
  const fields = profileFields(data.profiles, data);
  const base = { participant: { firstName: data.first_name, lastName: data.last_name, badgeRole }, profile: fields, eventName: data.events.name, extraRoles: opts.extraRoles };
  return {
    participantId: data.id,
    eventId: data.event_id,
    badgeRole,
    fields,
    public: toPublicProfile(base),
    staffView: toPublicProfile({ ...base, audience: 'staff' }),
  };
}
