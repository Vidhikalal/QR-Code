import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { normalizeEmail } from '@/lib/domain/normalize';
import { passToken, sha256hex } from '@/lib/domain/token';

export interface MyPass {
  participantId: string;
  event: { name: string; venue: string; startsAt: string; timezone: string };
  /** The token for `/p#…`; 'in_email' for a pass from before v0.4 (random token); 'on_its_way' while queued. */
  pass: { token: string } | 'in_email' | 'on_its_way';
}

// SPEC §6.1 (v0.4): the signed-in person's passes (matched by verified email) for events not yet over.
// The token is recomputed from the pass id; it was never stored.
export async function myPasses(db: SupabaseClient<Database>, email: string, secret: string, now: Date): Promise<MyPass[]> {
  const { data, error } = await db
    .from('participants')
    .select('id, events!inner(name, venue, starts_at, ends_at, timezone), passes(id, token_hash)')
    .eq('email', normalizeEmail(email))
    .eq('status', 'accepted')
    .is('deleted_at', null)
    .is('passes.revoked_at', null)
    .gt('events.ends_at', now.toISOString());
  if (error) throw new Error(`my passes lookup failed (${error.code})`);
  return data
    .map((p): MyPass => {
      const active = p.passes[0];
      const token = active ? passToken(secret, active.id) : null;
      return {
        participantId: p.id,
        event: { name: p.events.name, venue: p.events.venue, startsAt: p.events.starts_at, timezone: p.events.timezone },
        pass: !active || !token ? 'on_its_way' : sha256hex(token) === active.token_hash ? { token } : 'in_email',
      };
    })
    .sort((a, b) => a.event.startsAt.localeCompare(b.event.startsAt));
}
