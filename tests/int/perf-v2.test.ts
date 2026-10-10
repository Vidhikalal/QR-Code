import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// T-PERF2-02 against local Postgres: 500 people, 3,000 live scans and 5,000 connection taps in one
// event. The median of several runs, as in perf.test.ts.
let f: StandardFixture;
let someone = '';

async function median(runs: number, fn: () => Promise<unknown>): Promise<number> {
  await fn(); // warm-up
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] ?? Infinity;
}

beforeAll(async () => {
  f = await createStandardFixture();
  await f.pool.query(`insert into checkpoints (event_id, name, kind, requires_checkin, is_open, points) values ($1, 'Perf booth', 'custom', false, true, 3)`, [f.e1.id]);
  await f.pool.query(
    `insert into participants (event_id, external_id, email, first_name, last_name, search_text, status, source)
     select $1, 'perf-' || g, 'perf' || g || '@perf.test', 'Perf', 'P' || g, 'perf p' || g, 'accepted', 'seed'
       from generate_series(1, 500) g`,
    [f.e1.id],
  );
  // Every perf participant scanned once at each of the 6 checkpoints (D, L, W, R, G, Perf booth): 3,000 live scans.
  await f.pool.query(
    `insert into scans (event_id, participant_id, checkpoint_id, method, scanned_by, scanned_at, client_scan_id)
     select $1, p.id, c.id, 'manual', $2, e.starts_at + (random() * interval '6 hours'), gen_random_uuid()
       from participants p cross join checkpoints c join events e on e.id = $1
      where p.event_id = $1 and p.external_id like 'perf-%' and c.event_id = $1`,
    [f.e1.id, f.staff.org1],
  );
  // Person i connects both ways with i+1 … i+5 (wrapping): 2,500 mutual pairs, 5,000 taps.
  const tag = (await f.pool.query<{ id: string }>('insert into tags (event_id, public_id, registered_by) values ($1, $2, $3) returning id', [f.e1.id, randomBytes(9).toString('base64url'), f.staff.org1])).rows[0]?.id;
  await f.pool.query(
    `with p as (select id, row_number() over (order by external_id) - 1 as i from participants where event_id = $1 and external_id like 'perf-%'),
          pairs as (select a.id as x, b.id as y from p a join generate_series(1, 5) k on true join p b on b.i = (a.i + k) % 500)
     insert into connection_taps (event_id, from_participant_id, to_participant_id, via_tag_id, created_at)
     select $1, x, y, $2::uuid, now() - random() * interval '3 hours' from pairs
     union all
     select $1, y, x, $2::uuid, now() - random() * interval '3 hours' from pairs`,
    [f.e1.id, tag],
  );
  await f.pool.query('analyze participants; analyze scans; analyze connection_taps');
  const { rows } = await f.pool.query<{ s: number; t: number; who: string }>(
    `select (select count(*)::int from scans where event_id = $1) as s, (select count(*)::int from connection_taps where event_id = $1) as t,
            (select id from participants where event_id = $1 and external_id = 'perf-1') as who`,
    [f.e1.id],
  );
  expect([rows[0]?.s, rows[0]?.t]).toEqual([3000, 5000]);
  someone = rows[0]?.who ?? '';
});
afterAll(async () => {
  await f.close();
});

describe('leaderboard performance (PLAN §15.11)', () => {
  it('T-PERF2-02: leaderboard() takes < 200 ms for each board', async () => {
    for (const kind of ['activity', 'networking']) {
      const ms = await median(5, () => f.pool.query('select * from leaderboard($1, $2, now(), 10)', [f.e1.id, kind]));
      expect(ms, kind).toBeLessThan(200);
    }
  });

  it('T-PERF2-02: my_connections() takes < 50 ms', async () => {
    const { rows } = await f.pool.query<{ n: number }>(`select jsonb_array_length(my_connections($1) -> 'mutual') as n`, [someone]);
    expect(rows[0]?.n).toBe(10);
    const ms = await median(5, () => f.pool.query('select my_connections($1)', [someone]));
    expect(ms).toBeLessThan(50);
  });
});
