import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import type { RecapInput } from './template';

export { renderRecapEmail } from './template';

type Db = SupabaseClient<Database>;

const statsSchema = z.object({
  workshops: z.number(),
  activities: z.number(),
  connections: z.number(),
  activityPoints: z.number(),
  networkingPoints: z.number(),
});

/** Everything the recap needs about one person except their link: recap_stats + event + nickname. */
export async function loadRecapStats(db: Db, participantId: string): Promise<Omit<RecapInput, 'firstName' | 'connectionsUrl'> & { firstName: string }> {
  const [{ data: stats, error }, { data: p, error: pError }] = await Promise.all([
    db.rpc('recap_stats', { p_participant_id: participantId }),
    db.from('participants').select('first_name, profiles(nickname), events(name, recap_message, badge_unlock_password)').eq('id', participantId).single(),
  ]);
  if (error) throw new Error(`recap_stats failed (${error.code})`);
  if (pError) throw new Error(`participant load failed (${pError.code})`);
  return {
    firstName: p.first_name,
    nickname: p.profiles?.nickname ?? null,
    eventName: p.events.name,
    message: p.events.recap_message,
    unlockPassword: p.events.badge_unlock_password,
    stats: statsSchema.parse(stats),
  };
}
