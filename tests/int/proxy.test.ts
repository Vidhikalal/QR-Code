import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { createProxy } from '@/lib/http/proxy';
import { requireEnv } from '../fixtures/db';

// T-HOST-02 through the real proxy (Next 16 `proxy.ts`), with two hosts configured.
const proxy = createProxy({
  meOrigin: 'https://me.club.test',
  adminOrigin: 'https://admin.club.test',
  supabaseUrl: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  cookieDomain: '.club.test',
});
const get = (url: string) => proxy(new NextRequest(url));
const passesThrough = (res: Response) => res.headers.get('x-middleware-next') === '1';

describe('proxy host separation (PLAN §5.1)', () => {
  it('T-HOST-02: participant paths are 404 on the ADMIN host; staff paths are 404 on the ME host', async () => {
    for (const url of ['https://admin.club.test/me', 'https://admin.club.test/edit', 'https://admin.club.test/api/me/session', 'https://me.club.test/admin', 'https://me.club.test/api/admin/events', 'https://me.club.test/login']) {
      expect((await get(url)).status, url).toBe(404);
    }
  });

  it('T-HOST-02: participant paths on ME and shared staff APIs pass through without touching auth', async () => {
    for (const url of ['https://me.club.test/me', 'https://me.club.test/edit', 'https://me.club.test/api/scan', 'https://admin.club.test/api/scan', 'https://admin.club.test/login']) {
      expect(passesThrough(await get(url)), url).toBe(true);
    }
  });

  it('T-HOST-02: staff pages on the ADMIN host still send signed-out visitors to login with a way back', async () => {
    const res = await get('https://admin.club.test/admin/demo/participants?q=x');
    expect(res.status).toBe(307);
    // Absolute (Next only follows absolute redirects from proxy), on the host the browser used.
    expect(res.headers.get('location')).toBe(`https://admin.club.test/login?next=${encodeURIComponent('/admin/demo/participants?q=x')}`);
    const dev = await proxy(new NextRequest('http://localhost:3101/scan/demo', { headers: { host: 'admin.club.test' } }));
    expect(dev.headers.get('location')).toBe(`http://admin.club.test/login?next=${encodeURIComponent('/scan/demo')}`);
  });

  it('T-HOST-02: the Host header decides, not the URL Next normalized (dev rewrites nextUrl to localhost)', async () => {
    const asHost = (host: string, path: string) => proxy(new NextRequest(`http://localhost:3101${path}`, { headers: { host } }));
    expect((await asHost('me.club.test', '/login')).status).toBe(404);
    expect((await asHost('admin.club.test', '/me')).status).toBe(404);
    expect(passesThrough(await asHost('me.club.test', '/me'))).toBe(true);
  });

  it('T-HOST-01: a single host filters nothing', async () => {
    const single = createProxy({
      meOrigin: 'http://localhost:3000',
      adminOrigin: 'http://localhost:3000',
      supabaseUrl: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
      supabaseAnonKey: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    });
    for (const path of ['/me', '/edit', '/api/me', '/login', '/api/admin/events']) expect(passesThrough(await single(new NextRequest(`http://localhost:3000${path}`))), path).toBe(true);
  });
});
