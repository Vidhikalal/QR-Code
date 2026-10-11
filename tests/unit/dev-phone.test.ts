import { describe, expect, it } from 'vitest';
import { parseTunnelUrl } from '../../scripts/dev-phone-lib';

describe('pnpm dev:phone', () => {
  it('finds the quick-tunnel URL in cloudflared output, or null', () => {
    const banner = `2026-10-10T12:00:00Z INF +--------------------------------------------------------------------------------------------+
2026-10-10T12:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-10-10T12:00:00Z INF |  https://defend-excessive-tower-lil.trycloudflare.com                                      |`;
    expect(parseTunnelUrl(banner)).toBe('https://defend-excessive-tower-lil.trycloudflare.com');
    expect(parseTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeNull();
    expect(parseTunnelUrl('see https://www.cloudflare.com/website-terms/')).toBeNull();
  });
});
