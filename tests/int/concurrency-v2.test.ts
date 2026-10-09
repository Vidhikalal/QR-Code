import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStandardFixture, type Badges, type StandardFixture } from '../fixtures/standard';

// PLAN §15.11 (V5a). Genuinely parallel connections (pool ≥ N, Promise.all), as CLAUDE.md requires.
// T-CONC2-10: the nightly workflow loops this file too (CONC_ITERATIONS=100).
const ITERATIONS = Math.max(1, Number(process.env.CONC_ITERATIONS ?? '1'));

let f: StandardFixture;
let b: Badges;
beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 22 });
  b = await f.addBadges();
});
afterAll(async () => {
  await f.close();
});

async function parallel<T>(n: number, fn: (c: pg.PoolClient, i: number) => Promise<T>): Promise<T[]> {
  const clients = await Promise.all(Array.from({ length: n }, () => f.pool.connect()));
  try {
    return await Promise.all(clients.map((c, i) => fn(c, i)));
  } finally {
    for (const c of clients) c.release();
  }
}
const tally = (codes: string[]) => codes.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {});

async function newMeal(): Promise<string> {
  const { rows } = await f.pool.query<{ id: string }>(`insert into checkpoints (event_id, name, kind, requires_checkin, is_open) values ($1, $2, 'meal', false, true) returning id`, [
    f.e1.id,
    `Meal ${randomUUID()}`,
  ]);
  return rows[0]?.id ?? '';
}

describe(`meal concurrency (×${ITERATIONS})`, () => {
  for (let i = 0; i < ITERATIONS; i++) {
    it(`T-CONC2-01 / T-CONC2-10: 20 parallel first taps, same person, same meal → 1 ACCEPTED, 19 REPEAT_SERVING (#${i + 1})`, async () => {
      const meal = await newMeal();
      const rs = await parallel(20, (c) => f.tapBadge(f.staff.vol1, meal, b.tag.T1, { db: c }));
      expect(tally(rs.map((r) => r.code))).toEqual({ ACCEPTED: 1, REPEAT_SERVING: 19 });
    });

    it(`T-CONC2-03 / T-CONC2-10: 20 parallel retries of one confirmed repeat → 1 row, 1 ACCEPTED + 19 replayed (#${i + 1})`, async () => {
      const meal = await newMeal();
      await f.tapBadge(f.staff.vol1, meal, b.tag.T2);
      const id = randomUUID();
      const rs = await parallel(20, (c) => f.tapBadge(f.staff.vol1, meal, b.tag.T2, { db: c, confirmRepeat: true, clientScanId: id }));
      expect(rs.every((r) => r.code === 'ACCEPTED')).toBe(true);
      expect(rs.filter((r) => r.replayed === true)).toHaveLength(19);
      const { rows } = await f.pool.query<{ n: number }>('select count(*)::int as n from scans where client_scan_id = $1', [id]);
      expect(rows[0]?.n).toBe(1);
    });
  }

  it('T-CONC2-02: 10 parallel confirmed repeats → 10 distinct, consecutive serving numbers', async () => {
    const meal = await newMeal();
    await f.tapBadge(f.staff.vol1, meal, b.tag.T1);
    const rs = await parallel(10, (c) => f.tapBadge(f.staff.vol1, meal, b.tag.T1, { db: c, confirmRepeat: true }));
    expect(rs.every((r) => r.code === 'ACCEPTED')).toBe(true);
    expect(rs.map((r) => r.servingNo).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});
