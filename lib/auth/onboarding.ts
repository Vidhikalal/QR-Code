import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';

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
