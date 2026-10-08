import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { authCookieOptions } from '@/lib/auth/cookie-options';
import { routeForHost } from '@/lib/domain/host-routing';

export interface ProxyConfig {
  meOrigin: string;
  adminOrigin: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  cookieDomain?: string;
}

const STAFF_PAGES = /^\/(scan|admin)(\/|$)/;

// Next.js 16 "proxy" (formerly middleware), built from a config so tests can run it with two hosts.
// 1. Host separation (PLAN §5.1, I-23): a path that doesn't belong on this host is a 404.
// 2. Staff pages: refresh the Supabase session cookie and send signed-out visitors to /login with a
//    way back. Authorization is NOT done here: every handler checks the session and requireStaff().
export function createProxy(config: ProxyConfig) {
  return async function proxy(request: NextRequest): Promise<NextResponse> {
    const { pathname, search } = request.nextUrl;
    // The Host header, not nextUrl.host: `next dev` normalizes nextUrl to the address it listens on.
    const host = request.headers.get('host') ?? request.nextUrl.host;
    if (routeForHost({ host, pathname, meOrigin: config.meOrigin, adminOrigin: config.adminOrigin }) === 'not_found') {
      return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (!STAFF_PAGES.test(pathname)) return NextResponse.next();

    let response = NextResponse.next({ request });
    const supabase = createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
      ...authCookieOptions(config.cookieDomain),
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
    if (!data.user) {
      // Next only follows an absolute redirect from proxy; build it on the host the browser used.
      return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`${pathname}${search}`)}`, `${request.nextUrl.protocol}//${host}`));
    }
    return response;
  };
}
