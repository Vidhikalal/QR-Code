// The Coolify scheduled tasks (docs/launch-checklist.md): `node scripts/cron.mjs /api/cron` every 5 minutes,
// `node scripts/cron.mjs /api/retention` daily. Runs inside the app container, so the secret stays in its env.
const path = process.argv[2];
if (!path?.startsWith('/api/')) throw new Error('usage: node scripts/cron.mjs /api/<route>');
const res = await fetch(`http://localhost:${process.env.PORT ?? 3000}${path}`, {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.DRAIN_SECRET}` },
  signal: AbortSignal.timeout(60_000),
});
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);
