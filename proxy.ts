import type { NextRequest } from 'next/server';
import { badgePageLimiter, createProxy } from '@/lib/http/proxy';

// See lib/http/proxy.ts. Runs on every path except Next's static files (host separation needs that).
const handler = createProxy({
  meOrigin: process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000',
  adminOrigin: process.env.NEXT_PUBLIC_ADMIN_ORIGIN || process.env.NEXT_PUBLIC_APP_ORIGIN || 'http://localhost:3000',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  cookieDomain: process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN || undefined,
  ...(process.env.SUPABASE_SERVICE_ROLE_KEY && {
    limitBadgePage: badgePageLimiter(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY),
  }),
});

export function proxy(request: NextRequest) {
  return handler(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
