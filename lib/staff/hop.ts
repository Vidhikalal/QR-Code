import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Authenticate } from '@/lib/auth/session';
import { requireStaffBySlug } from '@/lib/auth/staff';
import type { Database } from '@/lib/db/types.gen';
import { toSearchText } from '@/lib/domain/normalize';
import { generateSecret, sha256hex } from '@/lib/domain/token';

type Db = SupabaseClient<Database>;

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const body = z.object({ slug: z.string().min(1).max(40) }).strict();
const ensured = z.object({ code: z.enum(['OK', 'FORBIDDEN', 'PROFILE_INCOMPLETE']), participantId: z.string().optional() });

// POST /api/staff/hop { slug }  (PLAN F15 "My badge profile"). Creates (or reuses) the staff member's
// own badge row, then a 2-minute organizer_hop code that only they can mint (issue_signin_code checks
// staff_user_id). The browser goes to ME_ORIGIN/signin#code, which opens a participant session there.
export function createHopApi(deps: { db: Db; authenticate: Authenticate; meOrigin: string; extraRoles: boolean }) {
  const { db } = deps;
  return {
    async hop(request: Request) {
      const user = await deps.authenticate(request);
      if (!user) return json({ error: 'unauthorized' }, 401);
      const parsed = body.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return json({ error: 'invalid_request' }, 400);
      const staff = await requireStaffBySlug(db, user.id, parsed.data.slug);
      // Volunteers get badge profiles only with FEATURE_EXTRA_BADGE_ROLES (PLAN Q2).
      if (!staff || (staff.role !== 'organizer' && !deps.extraRoles)) return json({ error: 'forbidden' }, 403);

      const { data: profile, error: profileError } = await db.from('staff_profiles').select('display_name').eq('user_id', user.id).maybeSingle();
      if (profileError) throw new Error(`staff profile load failed (${profileError.code})`);
      if (!profile) return json({ error: 'PROFILE_INCOMPLETE' }, 409);

      const { data, error } = await db.rpc('ensure_staff_attendee', {
        p_event_id: staff.eventId,
        p_user_id: user.id,
        p_search_text: toSearchText(profile.display_name),
      });
      if (error) throw new Error(`ensure_staff_attendee failed (${error.code})`);
      const row = ensured.parse(data);
      if (row.code === 'FORBIDDEN') return json({ error: 'forbidden' }, 403);
      if (row.code === 'PROFILE_INCOMPLETE' || !row.participantId) return json({ error: 'PROFILE_INCOMPLETE' }, 409);

      const code = generateSecret();
      const { data: issued, error: issueError } = await db.rpc('issue_signin_code', {
        p_participant_id: row.participantId,
        p_code_hash: sha256hex(code),
        p_purpose: 'organizer_hop',
        p_created_by: user.id,
      });
      if (issueError) throw new Error(`issue_signin_code failed (${issueError.code})`);
      if (issued !== 'ISSUED') return json({ error: issued === 'FORBIDDEN' ? 'forbidden' : 'not_eligible' }, issued === 'FORBIDDEN' ? 403 : 409);
      return json({ url: `${deps.meOrigin}/signin#${code}` });
    },
  };
}
