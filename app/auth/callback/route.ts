import { NextResponse } from 'next/server';
import { consumeInvites } from '@/lib/auth/invites';
import { safeNextPath } from '@/lib/auth/next-path';
import { needsOnboarding } from '@/lib/auth/onboarding';
import { supabaseForRequest } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { route } from '@/lib/http/route';

// SPEC F9: finish the magic-link sign-in, consume invites for the verified email, then send
// first-time staff to set a display name. Attendees (badge profiles, §6.5) skip that step.
export const GET = route(async (request) => {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));
  const code = url.searchParams.get('code');
  const supabase = await supabaseForRequest();
  const { data, error } = code ? await supabase.auth.exchangeCodeForSession(code) : { data: null, error: true };
  const user = data?.user;
  if (error || !user) {
    return NextResponse.redirect(new URL(`/login?error=link&next=${encodeURIComponent(next)}`, url.origin));
  }
  await consumeInvites(db(), { id: user.id, email: user.email ?? null });
  const target = (await needsOnboarding(db(), user.id)) ? `/onboarding?next=${encodeURIComponent(next)}` : next;
  return NextResponse.redirect(new URL(target, url.origin));
});
