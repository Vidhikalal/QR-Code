import type { NextConfig } from 'next';
import { securityHeaders } from './lib/domain/security-headers';

// Local dev only: the stable tunnel host (e.g. "brownsons-macbook-air.tail1234.ts.net") so a phone can
// load pages like /p#… through it. Next 16 blocks dev assets requested from unlisted hosts. A full URL
// is accepted too. Ignored by production builds. See README "A tunnel URL that never changes".
function devPublicHosts(): string[] {
  const raw = process.env.DEV_PUBLIC_HOST?.trim();
  if (!raw) return [];
  return [raw.includes('://') ? new URL(raw).hostname : raw];
}

// With two hosts configured locally (e.g. me.passline.test / admin.passline.test in the hosts e2e),
// those hosts must be allowed to load dev assets too.
function configuredHosts(): string[] {
  return [process.env.NEXT_PUBLIC_APP_ORIGIN, process.env.NEXT_PUBLIC_ADMIN_ORIGIN]
    .filter((o): o is string => !!o)
    .map((o) => new URL(o).hostname)
    .filter((h) => h !== 'localhost' && h !== '127.0.0.1');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [...devPublicHosts(), ...configuredHosts()],
  poweredByHeader: false,
  // forbidden() in the admin layout returns a real 403 (T-ADM-01). Experimental in Next 16.
  experimental: { authInterrupts: true },
  // T-SEC-06: on every response, pages and API routes alike.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders({
          production: process.env.NODE_ENV === 'production',
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
        }),
      },
    ];
  },
};

export default nextConfig;
