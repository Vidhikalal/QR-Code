import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, obj } from '../fixtures/admin-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN §8.2 / §13 (V5b): holder_involvement(), meal first servings vs seconds, servings.csv.
let f: StandardFixture;
let org: string;
const admin = adminClient();

beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

type Involvement = {
  doorAt: string | null;
  meals: Array<{ checkpointId: string; name: string; servings: Array<{ no: number; at: string }> }>;
  activities: Array<{ checkpointId: string; name: string; kind: string; at: string; points: number }>;
  points: number;
};
const involvement = async (id: string) => (await f.pool.query<{ r: Involvement }>('select holder_involvement($1) as r', [id])).rows[0]?.r;

describe('holder_involvement (PLAN §8.2)', () => {
  it('V5b: door time, numbered live servings, activities with points, and the points total; voided rows excluded', async () => {
    const n = await f.addParticipant(f.e1.id);
    await f.checkIn(n.id);
    const s1 = await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: n.id });
    const s2 = await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: n.id, confirmRepeat: true });
    await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: n.id, confirmRepeat: true });
    expect((await f.voidScan(s2.scanId ?? '', f.staff.vol1)).code).toBe('VOIDED');
    expect((await f.scan({ cp: f.cp.W, staff: f.staff.vol1, participantId: n.id })).points).toBe(10);
    expect((await f.scan({ cp: f.cp.G, staff: f.staff.vol1, participantId: n.id })).points).toBe(5);
    const v = await involvement(n.id);
    expect(v?.doorAt).toEqual(expect.any(String));
    expect(v?.meals).toEqual([{ checkpointId: f.cp.L, name: 'Lunch', servings: [{ no: 1, at: expect.any(String) }, { no: 3, at: expect.any(String) }] }]);
    expect(v?.activities.map((a) => [a.name, a.kind, a.points]).sort()).toEqual([
      ['Games', 'custom', 5],
      ['Workshop', 'session', 10],
    ]);
    expect(v?.points).toBe(15);
    expect(s1.servingNo).toBe(1);
  });

  it('V5b: someone with no scans has an empty summary', async () => {
    expect(await involvement(f.p.N)).toEqual({ doorAt: null, meals: [], activities: [], points: 0 });
  });
});

describe('meal analytics (PLAN §13)', () => {
  it('T-MEAL-07: first servings vs seconds, uptake on first servings, seconds rate; test and deleted excluded', async () => {
    // A fresh event so the golden numbers aren't disturbed by other tests in this file.
    const g = await createStandardFixture();
    try {
      const people = [await g.addParticipant(g.e1.id), await g.addParticipant(g.e1.id), await g.addParticipant(g.e1.id)];
      for (const p of people) await g.checkIn(p.id);
      await g.scan({ cp: g.cp.L, staff: g.staff.vol1, participantId: people[0]!.id });
      await g.scan({ cp: g.cp.L, staff: g.staff.vol1, participantId: people[0]!.id, confirmRepeat: true });
      await g.scan({ cp: g.cp.L, staff: g.staff.vol1, participantId: people[1]!.id });
      // Excluded: a test participant's serving.
      await g.checkIn(g.p.T, g.token.T);
      await g.scan({ cp: g.cp.L, staff: g.staff.vol1, token: g.token.T });
      const jwt = await signInAs(g.staffEmail.org1);
      const body = obj((await admin.call('dashboard', jwt, { slug: g.slug })).body);
      const lunch = (body.checkpoints as Array<Record<string, unknown>>).find((c) => c.name === 'Lunch');
      expect(lunch).toMatchObject({ kind: 'meal', liveScans: 3, firstServings: 2, seconds: 1, uptake: 0.6667, secondsRate: 0.5 });
      const workshop = (body.checkpoints as Array<Record<string, unknown>>).find((c) => c.name === 'Workshop');
      expect(workshop).not.toHaveProperty('firstServings');
    } finally {
      await g.close();
    }
  });
});

describe('servings.csv (PLAN §13)', () => {
  it('V5b: one row per live serving, with serving numbers; voided and test rows excluded; BOM', async () => {
    const n = await f.addParticipant(f.e1.id);
    await f.pool.query(`update participants set first_name = 'Serv' where id = $1`, [n.id]);
    await f.checkIn(n.id);
    await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: n.id });
    const two = await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: n.id, confirmRepeat: true });
    await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: n.id, confirmRepeat: true });
    await f.voidScan(two.scanId ?? '', f.staff.vol1);
    const r = await admin.call('exportCsv', org, { slug: f.slug, kind: 'servings.csv' });
    expect(r.status).toBe(200);
    const text = r.body as string;
    expect(text.startsWith('﻿"meal","serving","time","participant","method","scanned_by"\r\n')).toBe(true);
    const mine = text.split('\r\n').filter((l) => l.includes('"Serv Fixture"'));
    expect(mine.map((l) => l.split(',')[1])).toEqual(['"1"', '"3"']);
    expect(text).not.toContain('Tess'); // the test participant
  });
});
