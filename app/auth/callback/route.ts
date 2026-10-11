import { finishSignIn } from '@/lib/auth/finish-sign-in';
import { safeNextPath } from '@/lib/auth/next-path';
import { supabaseForRequest } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { redirectTo } from '@/lib/http/redirect';
import { route } from '@/lib/http/route';

// SPEC F9 / PLAN F13: finish the magic-link sign-in, then the shared post-sign-in steps (invites,
// platform admin, display name). Staff land on /admin by default. The code path is /auth/verify-code.
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
  return redirectTo(await finishSignIn(db(), { id: user.id, email: user.email ?? null }, next));
});
