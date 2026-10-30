import { describe, expect, it } from 'vitest';
import { ipKey } from '@/lib/pass/handlers';

const key = (headers: Record<string, string>) => ipKey(new Headers(headers));

describe('ipKey (SPEC §15)', () => {
  it('T-SEC-09: Vercel’s own client address wins over an X-Forwarded-For the client sent, so spoofing it changes nothing', () => {
    const real = key({ 'x-vercel-forwarded-for': '203.0.113.7' });
    for (const spoofed of ['1.1.1.1', '2.2.2.2, 203.0.113.7', 'not-an-ip']) {
      expect(key({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': spoofed })).toBe(real);
    }
    expect(key({ 'x-vercel-forwarded-for': '203.0.113.8' })).not.toBe(real);
  });

  it('T-SEC-09: behind Cloudflare, CF-Connecting-IP is used only when the request really came from a Cloudflare server', () => {
    const visitor = key({ 'x-vercel-forwarded-for': '203.0.113.9' });
    // Cloudflare proxying to Vercel: Vercel saw a Cloudflare address (IPv4 and IPv6 ranges).
    expect(key({ 'x-vercel-forwarded-for': '172.70.1.2', 'cf-connecting-ip': '203.0.113.9' })).toBe(visitor);
    expect(key({ 'x-vercel-forwarded-for': '2606:4700:10::1', 'cf-connecting-ip': '203.0.113.9' })).toBe(visitor);
    // Straight to Vercel (e.g. *.vercel.app/api/...) with a forged CF-Connecting-IP: ignored.
    expect(key({ 'x-vercel-forwarded-for': '198.51.100.50', 'cf-connecting-ip': '203.0.113.9' })).toBe(key({ 'x-vercel-forwarded-for': '198.51.100.50' }));
    // Running on Cloudflare itself (no Vercel header): Cloudflare sets CF-Connecting-IP and only appends to
    // X-Forwarded-For, so CF-Connecting-IP wins over a spoofed first entry.
    expect(key({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1, 203.0.113.9' })).toBe(visitor);
  });

  it('T-SEC-09: without it (local dev, tests): the first X-Forwarded-For entry, then X-Real-IP; the address is only ever hashed', () => {
    expect(key({ 'x-forwarded-for': '198.51.100.1, 172.16.0.1' })).toBe(key({ 'x-forwarded-for': '198.51.100.1' }));
    expect(key({ 'x-real-ip': '198.51.100.2' })).toBe(key({ 'x-forwarded-for': '198.51.100.2' }));
    expect(key({})).toBe(key({ 'x-forwarded-for': 'unknown' }));
    expect(key({ 'x-forwarded-for': '198.51.100.1' })).not.toContain('198.51.100.1');
    expect(ipKey(new Headers({ 'x-forwarded-for': '198.51.100.1' }), 'badge')).toMatch(/^badge:ip:[0-9a-f]{32}$/);
  });
});
