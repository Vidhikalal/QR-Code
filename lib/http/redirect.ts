import { NextResponse } from 'next/server';

// For route handlers: a relative Location (RFC 9110 §10.2.2), which the browser resolves against the
// host it actually used. An absolute URL from request.url is wrong behind two hostnames, because
// `next dev` rewrites request.url to the address it listens on (e.g. localhost:3101).
// Not for proxy.ts: Next only follows absolute redirects returned from proxy.
export function redirectTo(path: string, status: 303 | 307 = 307): NextResponse {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('redirectTo needs a same-site path');
  return new NextResponse(null, { status, headers: { Location: path } });
}
