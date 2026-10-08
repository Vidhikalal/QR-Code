import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { authCookieOptions } from '@/lib/auth/cookie-options';
import { routeForHost } from '@/lib/domain/host-routing';
import { hashedClientIp } from './rate-limit';

export interface ProxyConfig {
  meOrigin: string;
  adminOrigin: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  cookieDomain?: string;
  /** T-SEC2-03: true while this hashed IP is under the badge-page limit. Omitted: no limit. */
  limitBadgePage?: (ipHash: string) => Promise<boolean>;
}

const BADGE_PAGE = /^\/t\/[^/]+\/?$/;
const BADGE_PAGE_PER_MINUTE = 120;

/**
 * PLAN §9.3 `badge-page:ip`: 120 views/min per hashed IP, counted in Postgres (rate_limit_hit) through
 * PostgREST with the service key. Server-only: proxy.ts never runs in the browser.
 */
export function badgePageLimiter(supabaseUrl: string, serviceRoleKey: string) {
  return async (ipHash: string): Promise<boolean> => {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_key: `badge-page:ip:${ipHash}`, p_window_seconds: 60, p_limit: BADGE_PAGE_PER_MINUTE }),
    });
    if (!res.ok) throw new Error(`rate_limit_hit failed (${res.status})`);
    return (await res.json()) === true;
  };
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
    // A server component can't answer 429, so the badge page's limit lives here (I-17 allows the counter).
    if (config.limitBadgePage && BADGE_PAGE.test(pathname) && !(await config.limitBadgePage(hashedClientIp(request)))) {
      return new NextResponse('Too many requests. Wait a minute and try again.', { status: 429, headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60' } });
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
