import { describe, expect, it } from 'vitest';
import { authCookieOptions } from '@/lib/auth/cookie-options';
import { routeForHost } from '@/lib/domain/host-routing';

const ME = 'https://me.club.test';
const ADMIN = 'https://admin.club.test';
const on = (host: string, pathname: string, me = ME, admin = ADMIN) => routeForHost({ host, pathname, meOrigin: me, adminOrigin: admin });

const ME_ONLY = ['/p', '/edit', '/signin', '/me', '/me/connections', '/t/AbCdEfGhIjKl', '/api/me', '/api/me/session', '/api/t/x/this-is-me', '/api/pass', '/api/pass/photo', '/api/signin/request'];
const STAFF_ONLY = ['/', '/login', '/auth/callback', '/onboarding', '/admin', '/admin/new', '/admin/demo/participants', '/scan/demo', '/api/admin/events', '/api/admin/demo/dashboard', '/api/ingest/sheet', '/api/email/drain', '/api/retention', '/api/events/demo/checkpoints', '/api/scans/x/void'];
const SHARED = ['/api/events/demo/participants/search', '/api/scan', '/api/tags/assign', '/api/stations', '/api/participants/0000/signin-code', '/api/admin/demo/participants/0000/hide-profile', '/_next/static/chunk.js', '/favicon.ico'];

describe('host routing (PLAN §5.1, I-23)', () => {
  it('T-HOST-01: with equal origins (dev) every route is reachable', () => {
    for (const p of [...ME_ONLY, ...STAFF_ONLY, ...SHARED]) expect(on('localhost:3000', p, 'http://localhost:3000', 'http://localhost:3000'), p).toBe('allow');
  });

  it('T-HOST-02: ME-only paths are 404 on the ADMIN host and reachable on the ME host', () => {
    for (const p of ME_ONLY) {
      expect(on('admin.club.test', p), `admin ${p}`).toBe('not_found');
      expect(on('me.club.test', p), `me ${p}`).toBe('allow');
    }
  });

  it('T-HOST-02: staff paths are 404 on the ME host and reachable on the ADMIN host', () => {
    for (const p of STAFF_ONLY) {
      expect(on('me.club.test', p), `me ${p}`).toBe('not_found');
      expect(on('admin.club.test', p), `admin ${p}`).toBe('allow');
    }
  });

  it('T-HOST-02: the staff APIs the badge page needs, and static assets, answer on both hosts', () => {
    for (const p of SHARED) {
      expect(on('me.club.test', p), `me ${p}`).toBe('allow');
      expect(on('admin.club.test', p), `admin ${p}`).toBe('allow');
    }
  });

  it('T-HOST-02: prefixes match whole segments only (/pass is not /p, /media is not /me)', () => {
    expect(on('admin.club.test', '/pass')).toBe('allow');
    expect(on('admin.club.test', '/media')).toBe('allow');
    expect(on('me.club.test', '/pass')).toBe('not_found');
    expect(on('me.club.test', '/api/scans/x/void')).toBe('not_found');
    expect(on('me.club.test', '/api/participants/1/signin-code/extra')).toBe('not_found');
  });

  it('T-HOST-02: an unknown host (preview deployment, dev tunnel) is not filtered; ports must match', () => {
    expect(on('passline-git-x.vercel.app', '/admin')).toBe('allow');
    expect(on('passline-git-x.vercel.app', '/me')).toBe('allow');
    expect(on('admin.passline.test:3101', '/me', 'http://me.passline.test:3101', 'http://admin.passline.test:3101')).toBe('not_found');
  });
});

describe('auth cookie domain (PLAN §5.1, A-HOST-1)', () => {
  it('T-HOST-04 (unit): a cookie domain is set only when configured', () => {
    expect(authCookieOptions('.club.test')).toEqual({ cookieOptions: { domain: '.club.test' } });
    expect(authCookieOptions(undefined)).toEqual({});
    expect(authCookieOptions('')).toEqual({});
  });
});
