import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { consumeInvites, consumePlatformAdmin } from './invites';
import type { SessionUser } from './session';

// SPEC F9 / PLAN F13, after any staff sign-in (magic link or code): consume invites and platform-admin
// status for the verified email, then send first-timers to set a display name. Returns where to go.
export async function finishSignIn(db: SupabaseClient<Database>, user: SessionUser, next: string): Promise<string> {
  await consumeInvites(db, user);
  await consumePlatformAdmin(db, user);
  const { data: profile, error } = await db.from('staff_profiles').select('user_id').eq('user_id', user.id).maybeSingle();
  if (error) throw new Error(`staff profile load failed (${error.code})`);
  return profile ? next : `/onboarding?next=${encodeURIComponent(next)}`;
}
