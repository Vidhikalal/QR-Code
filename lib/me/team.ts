import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { normalizeEmail } from '@/lib/domain/normalize';
import { generateJoinCode, normalizeJoinCode, parseTeamName } from '@/lib/domain/team';
import type { MyEvent } from './profile';

type Db = SupabaseClient<Database>;
type Account = { id: string; email?: string | null };

// SPEC F15 (v0.7): what the team_* SQL functions answer; INVALID_NAME is caught here before any call.
const TEAM_CODES = ['CREATED', 'JOINED', 'LEFT', 'SAVED', 'IN_A_TEAM', 'NAME_TAKEN', 'BAD_CODE', 'TEAM_FULL', 'CLOSED', 'NOT_RELEASED', 'NOT_FOUND'] as const;
export type TeamCode = (typeof TEAM_CODES)[number] | 'INVALID_NAME';

// The functions act only on the row whose email is the account's, so a forged participant id changes nothing.
function own(user: Account, participantId: string) {
  if (!user.email || !z.uuid().safeParse(participantId).success) return null;
  return { p_participant_id: participantId, p_email: normalizeEmail(user.email), p_user_id: user.id };
}

function code(fn: string, r: { data: unknown; error: { code: string } | null }): TeamCode {
  if (r.error) throw new Error(`${fn} failed (${r.error.code})`);
  return z.enum(TEAM_CODES).parse(r.data);
}

export async function createTeam(db: Db, user: Account, participantId: string, name: string): Promise<TeamCode> {
  const teamName = parseTeamName(name);
  if (!teamName) return 'INVALID_NAME';
  const me = own(user, participantId);
  if (!me) return 'NOT_FOUND';
  return code('team_create', await db.rpc('team_create', { ...me, p_name: teamName, p_code: generateJoinCode() }));
}

export async function joinTeam(db: Db, user: Account, participantId: string, how: { code: string }): Promise<TeamCode> {
  const me = own(user, participantId);
  if (!me) return 'NOT_FOUND';
  const joinCode = normalizeJoinCode(how.code);
  if (!joinCode) return 'BAD_CODE';
  return code('team_join', await db.rpc('team_join', { ...me, p_code: joinCode }));
}

export async function leaveTeam(db: Db, user: Account, participantId: string): Promise<TeamCode> {
  const me = own(user, participantId);
  if (!me) return 'NOT_FOUND';
  return code('team_leave', await db.rpc('team_leave', me));
}

export async function setTeamTrack(db: Db, user: Account, participantId: string, trackId: string): Promise<TeamCode> {
  const me = own(user, participantId);
  if (!me || !z.uuid().safeParse(trackId).success) return 'NOT_FOUND';
  return code('team_set_track', await db.rpc('team_set_track', { ...me, p_track_id: trackId }));
}

export interface MyTeam {
  tracks: Array<{ id: string; name: string }>;
  team: { name: string; code: string; trackId: string | null; members: string[] } | null;
}

// /me/team: the event's tracks and the attendee's own team (teammates' names only). `me` comes from myEvent().
export async function myTeam(db: Db, me: MyEvent): Promise<MyTeam> {
  const [tracks, team] = await Promise.all([
    db.from('tracks').select('id, name').eq('event_id', me.eventId).order('created_at'),
    me.teamId
      ? db.from('teams').select('name, join_code, track_id, participants(first_name, last_name)').eq('id', me.teamId).eq('event_id', me.eventId).maybeSingle()
      : null,
  ]);
  if (tracks.error) throw new Error(`tracks load failed (${tracks.error.code})`);
  if (team?.error) throw new Error(`team load failed (${team.error.code})`);
  const t = team?.data;
  return {
    tracks: tracks.data,
    team: t
      ? { name: t.name, code: t.join_code, trackId: t.track_id, members: t.participants.map((m) => `${m.first_name} ${m.last_name}`.trim()).toSorted() }
      : null,
  };
}
