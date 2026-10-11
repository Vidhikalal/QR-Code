// pnpm dev:phone — the dev server behind a Cloudflare quick tunnel, so a phone gets HTTPS (camera and
// Web NFC need it) and badge URLs point somewhere the phone can reach. Local dev only.
//
// 1. Starts `cloudflared tunnel --url http://localhost:3000` and waits for its https URL.
// 2. Starts `next dev` with NEXT_PUBLIC_APP_ORIGIN / NEXT_PUBLIC_ADMIN_ORIGIN / DEV_PUBLIC_HOST set to it
//    (QR payloads, badge URLs and the scanner's parser all use that origin).
// 3. Prints the URL as a QR to scan with the phone. Ctrl+C stops both.
//
// The URL changes on every run: badges written during one run point at that run's URL (rewrite them,
// and never password-protect test badges). Staff sign in on the phone with the 6-digit code from the
// email, read in Mailpit on this laptop.
import { type ChildProcess, spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { parseTunnelUrl } from './dev-phone-lib';

const PORT = 3000;
const children: ChildProcess[] = [];
const stop = (code = 0) => {
  for (const c of children) c.kill('SIGTERM');
  process.exit(code);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

function startTunnel(): Promise<string> {
  return new Promise((resolve, reject) => {
    const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(tunnel);
    let seen = '';
    const timer = setTimeout(() => reject(new Error('cloudflared printed no tunnel URL within 45 s')), 45_000);
    const onData = (chunk: Buffer) => {
      seen = (seen + chunk.toString()).slice(-8_000);
      const url = parseTunnelUrl(seen);
      if (url) {
        clearTimeout(timer);
        resolve(url);
      }
    };
    tunnel.stdout.on('data', onData);
    tunnel.stderr.on('data', onData);
    tunnel.on('error', (err) => reject(new Error(`could not start cloudflared (brew install cloudflared): ${err.message}`)));
    tunnel.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared exited (${code ?? 'signal'})`));
    });
  });
}

async function main() {
  console.log('Starting a Cloudflare quick tunnel…');
  const url = await startTunnel();
  const env = { ...process.env, NEXT_PUBLIC_APP_ORIGIN: url, NEXT_PUBLIC_ADMIN_ORIGIN: url, DEV_PUBLIC_HOST: new URL(url).hostname };
  const next = spawn('pnpm', ['exec', 'next', 'dev', '--port', String(PORT)], { env, stdio: 'inherit' });
  children.push(next);
  next.on('exit', (code) => stop(code ?? 0));

  console.log(`\n${await QRCode.toString(url, { type: 'terminal', small: true })}`);
  console.log(`  Phone URL:  ${url}   (scan the QR above; give the tunnel ~20 s to come online)`);
  console.log(`  Staff sign-in on the phone: request the email, then type the 6-digit code from Mailpit: http://127.0.0.1:54324`);
  console.log(`  Seed passes for this URL:   NEXT_PUBLIC_APP_ORIGIN=${url} pnpm seed`);
  console.log(`  This laptop can keep using http://localhost:${PORT}, but QR codes and badges now point at the URL above.`);
  console.log('  Badges written in this run stop working when the tunnel restarts: rewrite them, and set no passwords.\n');
}

main().catch((err: unknown) => {
  console.error(`✕ ${err instanceof Error ? err.message : String(err)}`);
  stop(1);
});
