// PLAN §5.2: the participant session cookie on the ME host. Pure helpers; the value is a secret
// (I-18): only its sha256 is stored, and it travels only in this HttpOnly cookie.
const SECRET = /^[A-Za-z0-9_-]{43}$/;

const isHttps = (meOrigin: string) => new URL(meOrigin).protocol === 'https:';

// The __Host- prefix requires Secure, so plain http://localhost uses an unprefixed name.
export function participantCookieName(meOrigin: string): string {
  return isHttps(meOrigin) ? '__Host-pl_me' : 'pl_me';
}

// Host-only: no Domain attribute, so the cookie never leaves the ME host.
function serialize(meOrigin: string, value: string, maxAgeSeconds: number): string {
  const parts = [`${participantCookieName(meOrigin)}=${value}`, 'Path=/', `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax'];
  if (isHttps(meOrigin)) parts.push('Secure');
  return parts.join('; ');
}

export function serializeParticipantCookie(value: string, meOrigin: string, days: number): string {
  return serialize(meOrigin, value, days * 86_400);
}

export function clearParticipantCookie(meOrigin: string): string {
  return serialize(meOrigin, '', 0);
}

/** Our cookie's value from a Cookie header, or null if absent or not shaped like one of our secrets. */
export function readSessionValue(cookieHeader: string | null, meOrigin: string): string | null {
  if (!cookieHeader) return null;
  const name = participantCookieName(meOrigin);
  for (const pair of cookieHeader.split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0 && pair.slice(0, eq).trim() === name) {
      const value = pair.slice(eq + 1).trim();
      return SECRET.test(value) ? value : null;
    }
  }
  return null;
}

export const isSessionValue = (value: string | undefined | null): value is string => !!value && SECRET.test(value);
