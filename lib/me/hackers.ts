import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { normalizeEmail, toSearchText } from '@/lib/domain/normalize';
import type { MyEvent } from './profile';

const person = z.union([
  z.object({ id: z.uuid(), name: z.string(), bio: z.string().nullable(), pace: z.enum(['competitive', 'balanced', 'casual']).nullable(), teamName: z.string().nullable(), looking: z.boolean(), linkedinUrl: z.string().nullable(), discord: z.string().nullable(), websiteUrl: z.string().nullable() }).strict(),
  z.object({ id: z.uuid(), name: z.string() }).strict(),
]);

// Call only after myEvent confirms the viewer. No participant id comes from the request.
export async function hackerDirectory(db: SupabaseClient<Database>, me: MyEvent, email: string, filters: { looking: boolean; search: string; pace: string }) {
  const { data, error } = await db.rpc('hacker_directory', { p_event_id: me.eventId, p_email: normalizeEmail(email), p_looking: filters.looking });
  if (error) throw new Error(`hacker directory failed (${error.code})`);
  const search = toSearchText(filters.search);
  return z.array(person).parse(data).filter((p) => ('bio' in p || p.id !== me.participantId) && toSearchText(p.name).includes(search)
    && (!filters.pace || ('pace' in p && p.pace === filters.pace)))
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
