import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db/server';
import { normalizeEmail } from '@/lib/domain/normalize';
import { emailKey, ipKey, withinLimit } from '@/lib/pass/handlers';

// Next.js 16 "proxy" (formerly middleware). Refreshes the Supabase session cookie on staff pages and
// sends signed-out visitors to /login with a way back. Authorization is NOT done here: every route
// handler checks the session and requireStaff() itself.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });
  const { data } = await supabase.auth.getUser();

  // SPEC §15: badge pages are public and a badge's UID is in its URL, so slow down anyone walking through UIDs.
  // Signed in: per account (a whole venue can share one IP); signed out: per IP. Postgres-backed (serverless).
  if (request.nextUrl.pathname.startsWith('/profile/')) {
    const email = data.user?.email;
    const allowed = email
      ? await withinLimit(db(), emailKey('badge-view', normalizeEmail(email)), 60, 120)
      : await withinLimit(db(), ipKey(request.headers, 'badge-view'), 60, 300);
    if (!allowed) {
      return new NextResponse('Too many badge views. Wait a minute, then try again.', {
        status: 429,
        headers: { 'Retry-After': '60', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  }

  // Badge profiles are public (SPEC §6.5, v0.9): the session is still refreshed there, so the holder tapping
  // their own badge is recognized, but nobody is sent to sign in.
  if (!data.user && !request.nextUrl.pathname.startsWith('/profile/')) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  // /profile: session refresh only (above). /me: the hacker menu and its pages (F14, v0.6.1). `/me/:path*` also
  // matches /me itself.
  matcher: ['/scan/:path*', '/admin/:path*', '/profile/:path*', '/me/:path*'],
};
