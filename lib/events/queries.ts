import type { SupabaseClient } from '@supabase/supabase-js';
import type { StaffRole } from '@/lib/auth/staff';
import type { Database } from '@/lib/db/types.gen';

type Db = SupabaseClient<Database>;

export interface EventListItem {
  id: string;
  slug: string;
  name: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  /** null: a platform admin who isn't staff on this event. */
  myRole: StaffRole | null;
}

export async function isPlatformAdmin(db: Db, userId: string): Promise<boolean> {
  const { data, error } = await db.rpc('is_platform_admin', { p_user_id: userId });
  if (error) throw new Error(`is_platform_admin failed (${error.code})`);
  return data;
}

// PLAN §10.3: admins see every event; everyone else sees the events they staff.
export async function listEventsFor(db: Db, userId: string): Promise<EventListItem[]> {
  const { data, error } = await db.rpc('list_events_for', { p_user_id: userId });
  if (error) throw new Error(`list_events_for failed (${error.code})`);
  return data.map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.name,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    timezone: e.timezone,
    // The generated type says non-null, but the left join yields null for admin-only rows.
    myRole: (e.my_role as StaffRole | null) ?? null,
  }));
}

/** Where a staff member works on this event: organizers in the dashboard, volunteers in the scanner. */
export function eventHome(e: Pick<EventListItem, 'slug' | 'myRole'>): string {
  return e.myRole === 'volunteer' ? `/scan/${e.slug}` : `/admin/${e.slug}`;
}
