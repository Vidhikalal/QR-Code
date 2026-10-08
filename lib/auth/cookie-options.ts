// PLAN §5.1 / A-HOST-1: with a parent cookie domain (e.g. ".yourclub.ca") the staff Supabase session
// set on the ADMIN host is also sent to the ME host, so a staff phone tapping a badge is recognized.
// Unset (dev, single host): host-only cookies, as before. Passed to every Supabase client.
export function authCookieOptions(domain: string | undefined): { cookieOptions?: { domain: string } } {
  return domain ? { cookieOptions: { domain } } : {};
}

/** Client and server alike: Next inlines NEXT_PUBLIC_* values at build time. */
export const AUTH_COOKIE_DOMAIN = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN || undefined;
