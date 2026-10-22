import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.gen';

// Display names for staff user ids (who scanned, who voided). Unknown ids are simply absent.
export async function staffNames(db: SupabaseClient<Database>, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db.from('staff_profiles').select('user_id, display_name').in('user_id', [...new Set(ids)]);
  if (error) throw new Error(`staff_profiles load failed (${error.code})`);
  return new Map(data.map((r) => [r.user_id, r.display_name]));
}
