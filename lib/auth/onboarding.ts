import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { consumeInvites } from './invites';

// SPEC F9 (v0.3): the display-name step is only for staff (the name volunteers see next to scans).
// Attendees who sign in to view badge profiles (§6.5) go straight back to where they came from.
export async function needsOnboarding(db: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const [staff, profile] = await Promise.all([
    db.from('event_staff').select('user_id', { count: 'exact', head: true }).eq('user_id', userId),
    db.from('staff_profiles').select('user_id').eq('user_id', userId).maybeSingle(),
  ]);
  if (staff.error) throw new Error(`event_staff lookup failed (${staff.error.code})`);
  if (profile.error) throw new Error(`staff_profiles lookup failed (${profile.error.code})`);
  return (staff.count ?? 0) > 0 && !profile.data;
}

// Where a fresh sign-in goes: invites for the verified email become staff roles (F9 step 3), then staff
// without a display name get the onboarding step first.
export async function landingAfterSignIn(
  db: SupabaseClient<Database>,
  user: { id: string; email?: string | null },
  next: string,
): Promise<string> {
  await consumeInvites(db, { id: user.id, email: user.email ?? null });
  return (await needsOnboarding(db, user.id)) ? `/onboarding?next=${encodeURIComponent(next)}` : next;
}
