import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { createLeaderboardApi } from '@/lib/leaderboard/handlers';
import { serviceClient } from '../fixtures/mail';
import { participantClient } from '../fixtures/participant-api';
import { asBearer, bearerAuth, signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN §6.8 / F25 (V7): points_as_of, leaderboard, the organizer API, freeze, /api/me/points.
type Row = { rank: number; participant_id: string; display_name: string; points: number; reached_at: string };

// Default 'infinity' = everything committed. The host clock can trail the DB container's clock (Colima).
async function board(f: StandardFixture, kind: 'activity' | 'networking', asOf: Date | 'infinity' = 'infinity'): Promise<Row[]> {
  return (await f.pool.query<Row>('select * from leaderboard($1, $2, $3, 50)', [f.e1.id, kind, asOf === 'infinity' ? asOf : asOf.toISOString()])).rows;
}

async function attendee(f: StandardFixture, first: string) {
  const n = await f.addParticipant(f.e1.id);
  await f.pool.query('update participants set first_name = $2 where id = $1', [n.id, first]);
  await f.checkIn(n.id);
  const publicId = randomBytes(9).toString('base64url');
  await f.pool.query('insert into tags (event_id, public_id, registered_by) values ($1, $2, $3)', [f.e1.id, publicId, f.staff.org1]);
  await f.pool.query('select assign_tag($1, $2, $3, $4, null, false)', [f.e1.id, f.staff.org1, n.id, publicId]);
  return { id: n.id, publicId, name: `${first} F.` };
}
const mutual = async (f: StandardFixture, a: { id: string; publicId: string }, b: { id: string; publicId: string }) => {
  await f.pool.query('select record_connection($1, $2)', [a.id, b.publicId]);
  await f.pool.query('select record_connection($1, $2)', [b.id, a.publicId]);
};

describe('points and leaderboards in SQL (PLAN §15.9)', () => {
  let f: StandardFixture;
  beforeAll(async () => {
    f = await createStandardFixture({ poolSize: 4 });
  });
  afterAll(async () => {
    await f.close();
  });

  it('T-LB-02: activity points are the sum of checkpoint points over live scans', async () => {
    const p = await attendee(f, 'Act');
    await f.scan({ cp: f.cp.W, staff: f.staff.vol1, participantId: p.id }); // 10
    await f.scan({ cp: f.cp.G, staff: f.staff.vol1, participantId: p.id }); // 5
    await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: p.id }); // meal: 0
    const row = (await board(f, 'activity')).find((r) => r.participant_id === p.id);
    expect(row).toMatchObject({ display_name: 'Act F.', points: 15 });
  });

  it('T-LB-03 / T-LB-05: networking = 1 per mutual + 2 for an organizer; organizers compete off/on, no bonus between organizers', async () => {
    const b = await f.addBadges();
    const p = await attendee(f, 'Net');
    const q = await attendee(f, 'Pal');
    await mutual(f, p, q);
    await f.pool.query('select record_connection($1, $2)', [p.id, b.tag.T3.publicId]); // org1's badge row
    await f.pool.query('select record_connection($1, $2)', [b.orgRow, p.publicId]);
    let rows = await board(f, 'networking');
    expect(rows.find((r) => r.participant_id === p.id)?.points).toBe(1 + 1 + 2);
    expect(rows.find((r) => r.participant_id === b.orgRow)).toBeUndefined();
    await f.pool.query('update events set organizers_compete = true where id = $1', [f.e1.id]);
    rows = await board(f, 'networking');
    expect(rows.find((r) => r.participant_id === b.orgRow)?.points).toBe(1); // no bonus for the organizer
    await f.pool.query('update events set organizers_compete = false where id = $1', [f.e1.id]);
  });

  it('T-LB-04: as of an hour ago, later scans and taps don’t count', async () => {
    const p = await attendee(f, 'Late');
    await f.scan({ cp: f.cp.G, staff: f.staff.vol1, participantId: p.id });
    expect((await board(f, 'activity', new Date(Date.now() - 3600_000))).find((r) => r.participant_id === p.id)).toBeUndefined();
    expect((await board(f, 'activity')).find((r) => r.participant_id === p.id)?.points).toBe(5);
  });

  it('T-LB-06: a test participant is excluded, and a connection with them scores 0', async () => {
    const p = await attendee(f, 'Tst');
    const t = await attendee(f, 'Tess');
    await f.pool.query('update participants set is_test = true where id = $1', [t.id]);
    await mutual(f, p, t);
    await f.scan({ cp: f.cp.G, staff: f.staff.vol1, participantId: t.id });
    expect((await board(f, 'networking')).find((r) => r.participant_id === p.id)).toBeUndefined();
    expect((await board(f, 'activity')).find((r) => r.participant_id === t.id)).toBeUndefined();
  });

  it('T-LB-07: ties share a rank; whoever reached the score first is listed first', async () => {
    const g = await createStandardFixture();
    try {
      const [early, late] = [await attendee(g, 'Early'), await attendee(g, 'Late')];
      const s1 = await g.scan({ cp: g.cp.G, staff: g.staff.vol1, participantId: late.id });
      const s2 = await g.scan({ cp: g.cp.G, staff: g.staff.vol1, participantId: early.id });
      await g.pool.query(`update scans set scanned_at = now() - interval '10 minutes' where id = $1`, [s2.scanId]);
      await g.pool.query(`update scans set scanned_at = now() - interval '5 minutes' where id = $1`, [s1.scanId]);
      const rows = (await g.pool.query<Row>('select * from leaderboard($1, $2, now(), 10)', [g.e1.id, 'activity'])).rows;
      expect(rows.map((r) => [r.rank, r.display_name])).toEqual([
        [1, 'Early F.'],
        [1, 'Late F.'],
      ]);
    } finally {
      await g.close();
    }
  });
});

describe('leaderboard API, freeze and /api/me/points (PLAN §9.2)', () => {
  let f: StandardFixture;
  let org: string;
  let vol: string;
  const api = createLeaderboardApi({ db: serviceClient(), authenticate: bearerAuth });
  const me = participantClient();
  beforeAll(async () => {
    f = await createStandardFixture({ poolSize: 4 });
    await f.pool.query('update events set leaderboard_refresh_minutes = 0 where id = $1', [f.e1.id]); // live, for the test
    [org, vol] = await Promise.all([signInAs(f.staffEmail.org1), signInAs(f.staffEmail.vol1)]);
  });
  afterAll(async () => {
    await f.close();
  });

  const get = async (jwt: string | null, kind: string) => {
    const res = await api.get(new Request(`http://localhost/api/admin/x/leaderboard?kind=${kind}&limit=10`, { headers: asBearer(jwt) }), { slug: f.slug });
    return { status: res.status, body: (await res.json()) as { rows: Array<Record<string, unknown>>; asOf: string; nextRefreshAt: string | null; frozenAt: string | null } };
  };
  const freeze = async (jwt: string, frozen: boolean) =>
    (await api.freeze(new Request('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json', ...asBearer(jwt) }, body: JSON.stringify({ frozen }) }), { slug: f.slug })).status;

  it('T-LB-08: rows carry only rank, display name and points', async () => {
    const p = await attendee(f, 'Key');
    await f.scan({ cp: f.cp.G, staff: f.staff.vol1, participantId: p.id });
    const r = await get(org, 'activity');
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBeGreaterThan(0);
    for (const row of r.body.rows) expect(Object.keys(row).sort()).toEqual(['displayName', 'points', 'rank']);
    expect(JSON.stringify(r.body)).not.toContain(p.id);
    expect((await get(vol, 'activity')).status).toBe(403);
    expect((await get(org, 'karma')).status).toBe(400);
  });

  it('T-LB-10: freeze stops the board; unfreeze lets it move; both audited', async () => {
    const p = await attendee(f, 'Frz');
    expect(await freeze(org, true)).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    await f.scan({ cp: f.cp.G, staff: f.staff.vol1, participantId: p.id });
    const frozen = await get(org, 'activity');
    expect(frozen.body.frozenAt).not.toBeNull();
    expect(frozen.body.nextRefreshAt).toBeNull();
    expect(frozen.body.rows.find((r) => r.displayName === 'Frz F.')).toBeUndefined();
    expect(await freeze(org, false)).toBe(200);
    expect((await get(org, 'activity')).body.rows.find((r) => r.displayName === 'Frz F.')).toMatchObject({ points: 5 });
    const { rows } = await f.pool.query(`select action, detail from audit_log where event_id = $1 and action like 'leaderboard.%' order by id`, [f.e1.id]);
    expect(rows).toEqual([
      { action: 'leaderboard.freeze', detail: {} },
      { action: 'leaderboard.unfreeze', detail: {} },
    ]);
    expect(await freeze(vol, true)).toBe(403);
  });

  it('PLAN F25: /api/me/points gives live points and the projector rank; 401 without a session', async () => {
    const p = await attendee(f, 'Mine');
    await f.scan({ cp: f.cp.W, staff: f.staff.vol1, participantId: p.id });
    expect((await me.call('points', { method: 'GET' })).status).toBe(401);
    const key = generateSecret();
    await f.pool.query('select issue_profile_key($1, $2)', [p.id, sha256hex(key)]);
    const cookie = await me.signIn(key);
    const r = await me.call('points', { method: 'GET', cookie });
    expect(r.body).toMatchObject({ activity: 10, networking: 0, activityRank: 1, networkingRank: null });
  });
});
