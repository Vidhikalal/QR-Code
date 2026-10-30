import { NextRequest } from 'next/server';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { saveBadgeProfile } from '@/lib/me/profile';
import { createTeam, inviteTeammate, joinTeam, setLooking } from '@/lib/me/team';
import { runRetention } from '@/lib/privacy/retention';
import { proxy } from '@/proxy';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §15: per-account limits on attendee actions (keyed by the session's email, never a forgeable id),
// per-IP limits on anonymous badge-page views, and old counters pruned by the daily retention run.
let f: StandardFixture;
const db = serviceClient();
beforeAll(async () => {
  f = await createStandardFixture();
  await f.pool.query('update events set teams_open = true where id = $1', [f.e1.id]);
});
afterAll(async () => {
  await f.close();
});
const as = async (id: string) => ({ id: f.staff.vol1, email: (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]?.email ?? '' });

it('T-SEC-10: 30 profile saves per account in 10 minutes; the 31st changes nothing; another account is unaffected', async () => {
  const a = await as(f.p.A);
  for (let i = 0; i < 30; i++) expect(await saveBadgeProfile(db, a, f.p.A, { discord: `ada.${i}` })).toBe('SAVED');
  expect(await saveBadgeProfile(db, a, f.p.A, { discord: 'ada.late' })).toBe('RATE_LIMITED');
  const { rows } = await f.pool.query<{ discord_username: string }>('select discord_username from participants where id = $1', [f.p.A]);
  expect(rows[0]?.discord_username).toBe('ada.29');
  // Forging A's participant id from B's account neither saves nor uses up A's allowance.
  expect(await saveBadgeProfile(db, await as(f.p.B), f.p.A, { discord: 'not.ada' })).toBe('NOT_FOUND');
  expect(await saveBadgeProfile(db, await as(f.p.B), f.p.B, { discord: 'ben.ok' })).toBe('SAVED');
});

it('T-SEC-10: 20 team joins per account in 10 minutes, so join codes can’t be guessed; then even the right code waits', async () => {
  const b = await as(f.p.B);
  expect(await createTeam(db, await as(f.p.N), f.p.N, 'Rate Limited')).toBe('CREATED');
  const { rows } = await f.pool.query<{ join_code: string }>('select t.join_code from teams t join participants p on p.team_id = t.id where p.id = $1', [f.p.N]);
  for (let i = 0; i < 20; i++) expect(await joinTeam(db, b, f.p.B, { code: 'ZZZZ-ZZZZ' })).toBe('BAD_CODE');
  expect(await joinTeam(db, b, f.p.B, { code: rows[0]?.join_code ?? '' })).toBe('RATE_LIMITED');
  expect((await f.pool.query('select team_id from participants where id = $1', [f.p.B])).rows[0]?.team_id).toBeNull();
});

it('T-SEC-10: 20 invites per account per hour (each one can send an email)', async () => {
  const n = await as(f.p.N);
  expect(await setLooking(db, await as(f.p.A), f.p.A, true)).toBe('SAVED');
  expect(await inviteTeammate(db, n, f.p.N, f.p.A)).toBe('INVITED');
  for (let i = 1; i < 20; i++) expect(await inviteTeammate(db, n, f.p.N, f.p.A)).toBe('ALREADY_INVITED');
  expect(await inviteTeammate(db, n, f.p.N, f.p.A)).toBe('RATE_LIMITED');
});

it('T-SEC-11: 300 anonymous badge-page views per IP per minute, then 429; another IP is unaffected', async () => {
  const { uid } = await f.linkBadge(f.p.A);
  const view = (ip: string) => proxy(new NextRequest(`http://localhost:3000/profile/${uid}?tap`, { headers: { 'x-forwarded-for': ip } }));
  const ip = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const statuses: number[] = [];
  for (let i = 0; i < 300; i += 25) statuses.push(...(await Promise.all(Array.from({ length: 25 }, () => view(ip).then((r) => r.status)))));
  expect(statuses.filter((s) => s === 429)).toEqual([]);
  expect((await view(ip)).status).toBe(429);
  expect((await view(`${ip.replace('10.77', '10.78')}`)).status).not.toBe(429);
});

it('T-PRIV-04: the retention run deletes rate-limit counters older than a day, keeps current ones, and is idempotent', async () => {
  const key = `t-priv-04:${f.slug}`;
  await f.pool.query(
    `insert into rate_limits (key, window_start, hits) values ($1, now() - interval '2 days', 5), ($1, now() - interval '25 hours', 1), ($1, date_trunc('minute', now()), 2)`,
    [key],
  );
  const first = await runRetention(db, new Date());
  expect(first.rateLimitsPruned).toBeGreaterThanOrEqual(2);
  const { rows } = await f.pool.query<{ hits: number }>('select hits from rate_limits where key = $1', [key]);
  expect(rows).toEqual([{ hits: 2 }]);
  expect((await runRetention(db, new Date())).rateLimitsPruned).toBe(0);
});
