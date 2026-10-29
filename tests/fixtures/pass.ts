import { randomBytes } from 'node:crypto';
import { createPassHandler, createPassProfileHandler } from '@/lib/pass/handlers';
import { serviceClient } from './mail';

// Each client gets its own fake IP so per-IP rate limits never leak between tests.
export function passClient() {
  const db = serviceClient();
  const ip = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const pass = createPassHandler({ db });
  const profile = createPassProfileHandler({ db });

  const patch = (body: unknown) =>
    profile(
      new Request('http://localhost/api/pass', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 172.16.0.1` },
        body: JSON.stringify(body),
      }),
    );

  const lookup = (body: unknown, headers: Record<string, string> = {}) =>
    pass(
      new Request('http://localhost/api/pass', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 172.16.0.1`, ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );

  return { db, ip, lookup, patch };
}
