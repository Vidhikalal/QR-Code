import { consumeInvites, consumePlatformAdmin } from '@/lib/auth/invites';
import { safeNextPath } from '@/lib/auth/next-path';
import { supabaseForRequest } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { redirectTo } from '@/lib/http/redirect';
import { route } from '@/lib/http/route';

// SPEC F9 / PLAN F13: finish the magic-link sign-in, consume invites and platform-admin status for
// the verified email, then send first-timers to set a display name. Staff land on /admin by default.
export const GET = route(async (request) => {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'), '/admin');
  const code = url.searchParams.get('code');
  const supabase = await supabaseForRequest();
  const { data, error } = code ? await supabase.auth.exchangeCodeForSession(code) : { data: null, error: true };
  const user = data?.user;
  if (error || !user) {
    return redirectTo(`/login?error=link&next=${encodeURIComponent(next)}`);
  }
  const who = { id: user.id, email: user.email ?? null };
  await consumeInvites(db(), who);
  await consumePlatformAdmin(db(), who);
  const { data: profile } = await db().from('staff_profiles').select('user_id').eq('user_id', user.id).maybeSingle();
  const target = profile ? next : `/onboarding?next=${encodeURIComponent(next)}`;
  return redirectTo(target);
});
