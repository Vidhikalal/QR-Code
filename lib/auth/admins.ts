import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { normalizeEmail } from '@/lib/domain/normalize';

// SPEC F9 (v0.4.1): an account whose verified email is in ADMIN_EMAILS is organizer on every event.
export function isAdminEmail(email: string | null | undefined, admins: readonly string[]): boolean {
  return !!email && admins.includes(normalizeEmail(email));
}

// shortcut: runs at sign-in, so events created later are granted at the admin's next sign-in, and removing
// an address keeps the roles already granted (remove them on the Staff page).
export async function grantAdminRoles(db: SupabaseClient<Database>, userId: string): Promise<void> {
  const { error } = await db.rpc('grant_admin_roles', { p_user_id: userId });
  if (error) throw new Error(`grant_admin_roles failed (${error.code})`);
}
