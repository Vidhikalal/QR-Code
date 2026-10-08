import { randomBytes } from 'node:crypto';
import { createParticipantApi } from '@/lib/participant/handlers';
import { serviceClient } from './mail';

export const ME_ORIGIN = 'http://localhost:3100';

// Calls the participant handlers the way a browser on the ME host would: Origin header, cookie jar.
export function participantClient(meOrigin = ME_ORIGIN) {
  const scheduled: number[] = [];
  const api = createParticipantApi({ db: serviceClient(), meOrigin, sessionDays: 30, scheduleDrain: () => scheduled.push(Date.now()) });
  // A distinct client IP per client, so the per-IP rate limit never couples test files.
  const ip = `203.0.113.${randomBytes(1)[0]}-${randomBytes(4).toString('hex')}`;

  async function call(
    name: keyof typeof api,
    o: { method?: string; body?: unknown; cookie?: string | null; origin?: string | null; ip?: string } = {},
  ) {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': o.ip ?? ip };
    const origin = o.origin === undefined ? meOrigin : o.origin;
    if (origin !== null) headers.origin = origin;
    if (o.cookie) headers.cookie = o.cookie;
    const request = new Request(`${meOrigin}/api/me`, {
      method: o.method ?? 'POST',
      headers,
      ...(o.body !== undefined && { body: JSON.stringify(o.body) }),
    });
    const res = await api[name](request);
    const setCookie = res.headers.get('set-cookie');
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, body: body as Record<string, unknown> | null, setCookie };
  }

  /** Opens a session with an edit key; returns the Cookie header value to send next time. */
  async function signIn(key: string): Promise<string> {
    const r = await call('openSession', { body: { key } });
    if (r.body?.code !== 'OPENED' || !r.setCookie) throw new Error(`sign-in failed: ${JSON.stringify(r.body)}`);
    return r.setCookie.split(';')[0] ?? '';
  }

  return { api, call, signIn, ip, scheduled };
}
