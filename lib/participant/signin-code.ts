import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Authenticate } from '@/lib/auth/session';
import type { Database } from '@/lib/db/types.gen';
import { generateSecret, sha256hex } from '@/lib/domain/token';

type Db = SupabaseClient<Database>;

export const SIGNIN_CODE_TTL_MS = 2 * 60 * 1000;

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

// POST /api/participants/[id]/signin-code (PLAN F18 "Lost access to email"). Any staff member of the
// participant's event: issue_signin_code() checks membership in SQL (I-20) and audits the issue with
// ids and purpose only. The code leaves only in this response body, then in a URL fragment (I-18).
export function createSigninCodeApi(deps: { db: Db; authenticate: Authenticate; meOrigin: string; now?: () => Date }) {
  return {
    async issue(request: Request, params: Record<string, string>) {
      const user = await deps.authenticate(request);
      if (!user) return json({ error: 'unauthorized' }, 401);
      const participantId = z.uuid().safeParse(params.id).data;
      if (!participantId) return json({ error: 'not_found' }, 404);
      const code = generateSecret();
      const issuedAt = (deps.now ?? (() => new Date()))();
      const { data, error } = await deps.db.rpc('issue_signin_code', {
        p_participant_id: participantId,
        p_code_hash: sha256hex(code),
        p_purpose: 'staff_handoff',
        p_created_by: user.id,
      });
      if (error) throw new Error(`issue_signin_code failed (${error.code})`);
      if (data === 'FORBIDDEN') return json({ error: 'forbidden' }, 403);
      if (data === 'NOT_ELIGIBLE') return json({ error: 'not_eligible' }, 409);
      return json({ url: `${deps.meOrigin}/signin#${code}`, expiresAt: new Date(issuedAt.getTime() + SIGNIN_CODE_TTL_MS).toISOString() });
    },
  };
}
