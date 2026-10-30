import { BlockList, isIP } from 'node:net';

// Cloudflare's published ranges (https://www.cloudflare.com/ips/, checked 2026-10-29). Update them if
// Cloudflare adds ranges: a request from a missing range is limited by Cloudflare's address, never spoofable.
const CLOUDFLARE_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
const CLOUDFLARE_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_V4) cloudflare.addSubnet(range.split('/')[0] ?? '', Number(range.split('/')[1]), 'ipv4');
for (const range of CLOUDFLARE_V6) cloudflare.addSubnet(range.split('/')[0] ?? '', Number(range.split('/')[1]), 'ipv6');

const isCloudflare = (ip: string) => {
  const v = isIP(ip);
  return v !== 0 && cloudflare.check(ip, v === 4 ? 'ipv4' : 'ipv6');
};
const first = (value: string | null) => value?.split(',')[0]?.trim() || '';

// SPEC §15 (T-SEC-09): the address rate limits are keyed by (hashed, I-11).
// - On Vercel, x-vercel-forwarded-for is the address Vercel saw; no client can set it. When that address is
//   Cloudflare's (Cloudflare proxying to Vercel), Cloudflare's CF-Connecting-IP holds the visitor. A
//   CF-Connecting-IP on a request that didn't come from Cloudflare (straight to *.vercel.app) is forged: ignored.
// - Without it (running on Cloudflare, local dev, tests): CF-Connecting-IP, else the first X-Forwarded-For
//   entry, else X-Real-IP. A self-hosted deployment must sit behind a proxy that overwrites these headers.
export function clientIp(headers: Headers): string {
  const viaVercel = first(headers.get('x-vercel-forwarded-for'));
  const viaCloudflare = headers.get('cf-connecting-ip')?.trim() || '';
  if (viaVercel) return viaCloudflare && isCloudflare(viaVercel) ? viaCloudflare : viaVercel;
  return viaCloudflare || first(headers.get('x-forwarded-for')) || headers.get('x-real-ip')?.trim() || 'unknown';
}
