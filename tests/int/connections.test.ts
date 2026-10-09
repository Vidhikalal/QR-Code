import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { adminClient, obj } from '../fixtures/admin-api';
import { participantClient } from '../fixtures/participant-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type Badges, type StandardFixture } from '../fixtures/standard';

// PLAN §6.8 / F24 (V6): mutual connections. SQL first, then the participant API.
let f: StandardFixture;
let b: Badges;
const me = participantClient();
const admin = adminClient();

beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 6 });
  b = await f.addBadges(); // A wears T1, B wears T2, org1's badge row wears T3
});
afterAll(async () => {
  await f.close();
});

type R = { code: string; otherId?: string };
const connect = async (from: string, publicId: string) => (await f.pool.query<{ r: R }>('select record_connection($1, $2) as r', [from, publicId])).rows[0]?.r;
type Mine = { mutual: Array<{ participantId: string; displayName: string; badgeRole: string; linkedinUrl: string | null; badgePublicId: string | null; mutualAt: string }>; pendingOut: number };
const mine = async (id: string) => (await f.pool.query<{ r: Mine }>('select my_connections($1) as r', [id])).rows[0]?.r;

/** A checked-in participant wearing a fresh badge. */
async function attendee(first: string) {
  const n = await f.addParticipant(f.e1.id);
  await f.pool.query('update participants set first_name = $2 where id = $1', [n.id, first]);
  await f.checkIn(n.id);
  const publicId = randomBytes(9).toString('base64url');
  await f.pool.query('insert into tags (event_id, public_id, uid, registered_by) values ($1, $2, $3, $4)', [f.e1.id, publicId, `04${randomBytes(6).toString('hex').toUpperCase()}`, f.staff.org1]);
  await f.pool.query('select assign_tag($1, $2, $3, $4, null, false)', [f.e1.id, f.staff.org1, n.id, publicId]);
  return { id: n.id, publicId };
}

describe('record_connection (PLAN §15.8)', () => {
  it('T-CONN-01: a participant without a door scan → NOT_CHECKED_IN', async () => {
    expect((await connect(f.p.N, b.tag.T1.publicId))?.code).toBe('NOT_CHECKED_IN');
  });

  it('T-CONN-02 / T-CONN-03: own badge, unlinked, replaced and other-event badges', async () => {
    const x = await attendee('Xia');
    expect((await connect(x.id, x.publicId))?.code).toBe('SELF');
    expect((await connect(x.id, b.tag.T4.publicId))?.code).toBe('TAG_UNASSIGNED');
    expect((await connect(x.id, b.tag.T9.publicId))?.code).toBe('WRONG_EVENT');
    const y = await attendee('Yan');
    await f.pool.query('select assign_tag($1, $2, $3, $4, null, true)', [f.e1.id, f.staff.org1, y.id, b.tag.T5.publicId]); // y's first badge retired
    expect((await connect(x.id, y.publicId))?.code).toBe('TAG_REPLACED');
    expect((await connect(x.id, 'AAAAAAAAAAAA'))?.code).toBe('NOT_FOUND');
  });

  it('T-CONN-04: A→B, A→B, B→A, B→A → PENDING, ALREADY_PENDING, MUTUAL, ALREADY_MUTUAL', async () => {
    const [a, c] = [await attendee('Ana'), await attendee('Cal')];
    expect((await connect(a.id, c.publicId))?.code).toBe('PENDING');
    expect((await connect(a.id, c.publicId))?.code).toBe('ALREADY_PENDING');
    expect(await connect(c.id, a.publicId)).toEqual({ code: 'MUTUAL', otherId: a.id });
    expect((await connect(c.id, a.publicId))?.code).toBe('ALREADY_MUTUAL');
  });

  it('T-CONN-05 / T-PROF-08 (connections): mutual only, newest first, "First L." fallback, pending count, hidden LinkedIn omitted', async () => {
    const [m, p1, p2, p3] = [await attendee('Mia'), await attendee('Pam'), await attendee('Quin'), await attendee('Rob')];
    await f.pool.query(`insert into profiles (participant_id, nickname, linkedin_url) values ($1, 'Pammy', 'https://www.linkedin.com/in/pam') on conflict (participant_id) do update set nickname = excluded.nickname, linkedin_url = excluded.linkedin_url`, [p1.id]);
    await f.pool.query(`insert into profiles (participant_id, linkedin_url, visibility) values ($1, 'https://www.linkedin.com/in/quin', 'hidden') on conflict (participant_id) do update set linkedin_url = excluded.linkedin_url, visibility = excluded.visibility`, [p2.id]);
    await connect(m.id, p1.publicId);
    await connect(p1.id, m.publicId);
    await connect(m.id, p2.publicId);
    await connect(p2.id, m.publicId);
    await connect(m.id, p3.publicId); // pending
    const r = await mine(m.id);
    expect(r?.pendingOut).toBe(1);
    expect(r?.mutual.map((x) => [x.displayName, x.linkedinUrl, x.badgePublicId])).toEqual([
      ['Quin F.', null, p2.publicId],
      ['Pammy', 'https://www.linkedin.com/in/pam', p1.publicId],
    ]);
  });

  it('T-CONN-06: an organizer (staff badge row, no door scan) tapping back → MUTUAL', async () => {
    const a = await attendee('Orla');
    expect((await connect(a.id, b.tag.T3.publicId))?.code).toBe('PENDING');
    expect((await connect(b.orgRow, a.publicId))?.code).toBe('MUTUAL');
  });
});

describe('connections API (PLAN §9.2)', () => {
  async function cookieFor(id: string) {
    const key = generateSecret();
    await f.pool.query('select issue_profile_key($1, $2)', [id, sha256hex(key)]);
    return me.signIn(key);
  }

  it('T-CONN-08 / T-SEC2-06: no session → 401; foreign Origin → 403; with a session the copy names the other person', async () => {
    const [a, c] = [await attendee('Ivy'), await attendee('Jon')];
    expect((await me.call('listConnections', { method: 'GET' })).status).toBe(401);
    expect((await me.call('connect', { body: { tagPublicId: c.publicId } })).status).toBe(401);
    const cookie = await cookieFor(a.id);
    expect((await me.call('connect', { body: { tagPublicId: c.publicId }, cookie, origin: 'https://evil.example' })).status).toBe(403);
    expect((await me.call('connect', { body: { tagPublicId: c.publicId }, cookie })).body).toEqual({ code: 'PENDING', otherName: 'Jon F.' });
    expect((await me.call('connect', { body: { tagPublicId: 'bad' }, cookie })).status).toBe(400);
    const list = await me.call('listConnections', { method: 'GET', cookie });
    expect(list.body).toMatchObject({ mutual: [], pendingOut: 1 });
  });

  it('T-CONN-07: the 121st connect request in an hour is rate limited', async () => {
    const a = await attendee('Kim');
    const cookie = await cookieFor(a.id);
    const statuses: number[] = [];
    for (let i = 0; i < 121; i++) statuses.push((await me.call('connect', { body: { tagPublicId: b.tag.T4.publicId }, cookie })).status);
    expect(statuses.slice(0, 120).every((s) => s === 200)).toBe(true);
    expect(statuses[120]).toBe(429);
  });
});

describe('connection metrics (PLAN §13)', () => {
  it('V6: dashboard stats and connections_summary.csv count mutual pairs; the CSV never says who met whom', async () => {
    const g = await createStandardFixture();
    try {
      const gb = await g.addBadges();
      await g.checkIn(g.p.A, g.token.A);
      await g.checkIn(g.p.B, g.token.B);
      await g.pool.query('select record_connection($1, $2)', [g.p.A, gb.tag.T2.publicId]);
      await g.pool.query('select record_connection($1, $2)', [g.p.B, gb.tag.T1.publicId]);
      const jwt = await signInAs(g.staffEmail.org1);
      const body = obj((await admin.call('dashboard', jwt, { slug: g.slug })).body);
      expect(body.connections).toEqual({ mutualPairs: 1, peopleWithAny: 2, checkedIn: 2, averagePerCheckedIn: 1, shareWithAny: 1 });
      const csv = (await admin.call('exportCsv', jwt, { slug: g.slug, kind: 'connections_summary.csv' })).body as string;
      expect(csv.startsWith('﻿"participant","mutual_connections","pending_taps"\r\n')).toBe(true);
      const ada = csv.split('\r\n').find((l) => l.startsWith('"Ada Fixture"'));
      expect(ada).toBe('"Ada Fixture","1","0"');
      expect(csv).not.toContain(g.p.B);
    } finally {
      await g.close();
    }
  });
});
