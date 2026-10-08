import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { sha256hex } from '@/lib/domain/token';

// SPEC §15: Postgres-backed limits (serverless instances share no memory).
export async function withinLimit(db: SupabaseClient<Database>, key: string, windowSeconds: number, limit: number): Promise<boolean> {
  const { data, error } = await db.rpc('rate_limit_hit', { p_key: key, p_window_seconds: windowSeconds, p_limit: limit });
  if (error) throw new Error(`rate_limit_hit failed (${error.code})`);
  return data;
}

// The client IP, hashed: no raw address is ever stored (I-11).
export function hashedClientIp(request: Request): string {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return sha256hex(ip).slice(0, 32);
}
