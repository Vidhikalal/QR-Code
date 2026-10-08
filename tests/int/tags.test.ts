import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTagsApi } from '@/lib/tags/handlers';
import { serviceClient } from '../fixtures/mail';
import { ME_ORIGIN } from '../fixtures/participant-api';
import { asBearer, bearerAuth, signInAs } from '../fixtures/staff';
import { createStandardFixture, type Badges, type StandardFixture } from '../fixtures/standard';

// PLAN §6.5 (V4a): tags, assignments, register/reserve, stations. SQL first, then the API.
let f: StandardFixture;
let b: Badges;
let orgJwt: string;
let volJwt: string;
const api = createTagsApi({ db: serviceClient(), authenticate: bearerAuth, meOrigin: ME_ORIGIN });

beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 12 });
  b = await f.addBadges();
  [orgJwt, volJwt] = await Promise.all([signInAs(f.staffEmail.org1), signInAs(f.staffEmail.vol1)]);
});
afterAll(async () => {
  await f.close();
});

type R = { code: string; [k: string]: unknown };
const sql = async <T = R>(q: string, params: unknown[]) => (await f.pool.query<{ r: T }>(q, params)).rows[0]?.r as T;
const assign = (staff: string, who: string, o: { publicId?: string | null; uid?: string | null; replace?: boolean; event?: string } = {}) =>
  sql('select assign_tag($1, $2, $3, $4, $5, $6) as r', [o.event ?? f.e1.id, staff, who, o.publicId ?? null, o.uid ?? null, o.replace ?? false]);
const register = (staff: string, publicId: string, uid: string | null, event = f.e1.id) =>
  sql<string>('select register_tag($1, $2, $3, $4) as r', [event, staff, publicId, uid]);
const freshId = () => randomBytes(9).toString('base64url');
const freshUid = () => `04${randomBytes(6).toString('hex').toUpperCase()}`;

describe('assign_tag (PLAN §6.5)', () => {
  it('T-TAG-01: link, then link again → ASSIGNED, ALREADY_ASSIGNED', async () => {
    const n = await f.addParticipant(f.e1.id);
    expect((await assign(f.staff.vol1, n.id, { publicId: b.tag.T4.publicId })).code).toBe('ASSIGNED');
    expect((await assign(f.staff.vol1, n.id, { publicId: b.tag.T4.publicId })).code).toBe('ALREADY_ASSIGNED');
  });

  it('T-TAG-02: someone else’s badge → TAG_IN_USE with the holder’s name (no email)', async () => {
    const n = await f.addParticipant(f.e1.id);
    const r = await assign(f.staff.vol1, n.id, { publicId: b.tag.T1.publicId });
    expect(r.code).toBe('TAG_IN_USE');
    expect(r.holder).toMatchObject({ id: f.p.A, displayName: 'Ada Fixture' });
    expect(JSON.stringify(r)).not.toContain('@');
  });

  it('T-TAG-03: a second badge for the same person → PARTICIPANT_HAS_TAG with the current label', async () => {
    const r = await assign(f.staff.vol1, f.p.A, { publicId: b.tag.T5.publicId });
    expect(r).toMatchObject({ code: 'PARTICIPANT_HAS_TAG', currentTag: { label: 'T1' } });
  });

  it('T-TAG-04/05/06/07: wrong event, unknown badge, waitlisted person, other-event staff', async () => {
    expect((await assign(f.staff.vol1, f.p.N, { publicId: b.tag.T9.publicId })).code).toBe('TAG_WRONG_EVENT');
    expect((await assign(f.staff.vol1, f.p.N, { publicId: freshId() })).code).toBe('TAG_NOT_FOUND');
    expect((await assign(f.staff.vol1, f.p.C, { publicId: b.tag.T6.publicId })).code).toBe('NOT_ACCEPTED');
    expect((await assign(f.staff.vol3, f.p.N, { publicId: b.tag.T6.publicId })).code).toBe('FORBIDDEN');
  });

  it('T-TAG-08: link by chip serial only', async () => {
    const n = await f.addParticipant(f.e1.id);
    expect((await assign(f.staff.vol1, n.id, { uid: b.tag.T7.uid })).code).toBe('ASSIGNED');
  });

  it('T-TAG-09: replace: refused without the flag; with it the old badge is retired; the old badge can’t be reused', async () => {
    const n = await f.addParticipant(f.e1.id);
    const [old, next] = [await makeTag(), await makeTag()];
    expect((await assign(f.staff.vol1, n.id, { publicId: old.publicId })).code).toBe('ASSIGNED');
    expect((await assign(f.staff.vol1, n.id, { publicId: next.publicId })).code).toBe('PARTICIPANT_HAS_TAG');
    expect(await assign(f.staff.vol1, n.id, { publicId: next.publicId, replace: true })).toMatchObject({ code: 'ASSIGNED', replaced: true });
    const other = await f.addParticipant(f.e1.id);
    expect((await assign(f.staff.vol1, other.id, { publicId: old.publicId })).code).toBe('TAG_RETIRED');
    const { rows } = await f.pool.query('select retire_reason from tags where public_id = $1', [old.publicId]);
    expect(rows).toEqual([{ retire_reason: 'replaced' }]);
  });

  it('T-TAG-10: unlink: other volunteer FORBIDDEN; own within 120 s UNASSIGNED; own at 121 s FORBIDDEN; badge reusable', async () => {
    const n = await f.addParticipant(f.e1.id);
    const t = await makeTag();
    const linked = await assign(f.staff.vol1, n.id, { publicId: t.publicId });
    const id = linked.assignmentId as string;
    expect(await sql<string>('select unassign_tag($1, $2) as r', [id, f.staff.vol2])).toBe('FORBIDDEN');
    expect(await sql<string>('select unassign_tag($1, $2) as r', [id, f.staff.vol1])).toBe('UNASSIGNED');
    expect((await assign(f.staff.vol1, n.id, { publicId: t.publicId })).code).toBe('ASSIGNED');
    const again = (await f.pool.query<{ id: string }>('select id from tag_assignments where tag_id = $1 and ended_at is null', [t.id])).rows[0]?.id;
    await f.pool.query(`update tag_assignments set assigned_at = now() - interval '121 seconds' where id = $1`, [again]);
    expect(await sql<string>('select unassign_tag($1, $2) as r', [again, f.staff.vol1])).toBe('FORBIDDEN');
    expect(await sql<string>('select unassign_tag($1, $2) as r', [again, f.staff.org1])).toBe('UNASSIGNED');
  });

  it('T-TAG-12: a raw insert linking an E2 badge to an E1 person violates the composite FK', async () => {
    await expect(
      f.pool.query('insert into tag_assignments (event_id, tag_id, participant_id, assigned_by) values ($1, $2, $3, $4)', [f.e1.id, b.tag.T9.id, f.p.N, f.staff.org1]),
    ).rejects.toThrow(/foreign key/);
  });

  it('V4a tombstone: deleting a participant ends their badge link (participant_removed)', async () => {
    const n = await f.addParticipant(f.e1.id);
    const t = await makeTag();
    await assign(f.staff.vol1, n.id, { publicId: t.publicId });
    expect((await sql('select delete_participant($1, $2, $3) as r', [f.e1.id, n.id, f.staff.org1])).code).toBe('DELETED');
    const { rows } = await f.pool.query('select end_reason from tag_assignments where tag_id = $1', [t.id]);
    expect(rows).toEqual([{ end_reason: 'participant_removed' }]);
  });
});

describe('register_tag and reserve_tag (PLAN F19)', () => {
  it('T-TAG-11: the full register/confirm table', async () => {
    const id = freshId();
    const uid = freshUid();
    expect(await register(f.staff.vol1, freshId(), freshUid())).toBe('FORBIDDEN');
    expect(await register(f.staff.org1, id, null)).toBe('REGISTERED'); // reserve
    expect(await register(f.staff.org1, id, null)).toBe('ALREADY_REGISTERED');
    expect(await register(f.staff.org1, id, uid)).toBe('REGISTERED'); // confirm
    expect(await register(f.staff.org1, id, uid)).toBe('ALREADY_REGISTERED');
    expect(await register(f.staff.org1, freshId(), uid)).toBe('UID_CONFLICT');
    expect(await register(f.staff.org1, id, freshUid())).toBe('PUBLIC_ID_CONFLICT');
    expect(await register(f.staff.org1, b.tag.T9.publicId, freshUid())).toBe('PUBLIC_ID_CONFLICT'); // owned by E2
  });

  it('V4a: 20 parallel reserves get 20 distinct, sequential labels', async () => {
    const event = (await f.pool.query<{ r: { eventId: string } }>(
      `select create_event($1, $2, 'Labels', 'Hall', now(), now() + interval '1 day', 'America/Toronto') as r`,
      [(await f.addPlatformAdmin()).id, `lbl-${randomBytes(4).toString('hex')}`],
    )).rows[0]?.r.eventId;
    const admin = (await f.pool.query<{ user_id: string }>('select user_id from event_staff where event_id = $1', [event])).rows[0]?.user_id;
    const clients = await Promise.all(Array.from({ length: 10 }, () => f.pool.connect()));
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => clients[i % 10]!.query<{ r: R }>('select reserve_tag($1, $2, $3) as r', [event, admin, freshId()])),
      );
      const labels = results.map((r) => r.rows[0]?.r.label as string).sort();
      expect(labels).toEqual(Array.from({ length: 20 }, (_, i) => `B-${String(i + 1).padStart(4, '0')}`));
    } finally {
      for (const c of clients) c.release();
    }
  });
});

describe('concurrency (PLAN §15.11)', () => {
  const parallel = async (n: number, fn: (c: import('pg').PoolClient, i: number) => Promise<R>) => {
    const clients = await Promise.all(Array.from({ length: n }, () => f.pool.connect()));
    try {
      return await Promise.all(clients.map((c, i) => fn(c, i)));
    } finally {
      for (const c of clients) c.release();
    }
  };
  const assignOn = async (c: import('pg').PoolClient, who: string, publicId: string, replace = false) =>
    (await c.query<{ r: R }>('select assign_tag($1, $2, $3, $4, null, $5) as r', [f.e1.id, f.staff.vol1, who, publicId, replace])).rows[0]!.r;
  const counts = (rs: R[]) => rs.reduce<Record<string, number>>((m, r) => ({ ...m, [r.code]: (m[r.code] ?? 0) + 1 }), {});

  it('T-CONC2-04: one blank badge linked to 10 people at once → 1 ASSIGNED, 9 TAG_IN_USE', async () => {
    const t = await makeTag();
    const people = await Promise.all(Array.from({ length: 10 }, () => f.addParticipant(f.e1.id)));
    expect(counts(await parallel(10, (c, i) => assignOn(c, people[i]!.id, t.publicId)))).toEqual({ ASSIGNED: 1, TAG_IN_USE: 9 });
  });

  it('T-CONC2-05: 10 badges linked to one person at once → 1 ASSIGNED, 9 PARTICIPANT_HAS_TAG', async () => {
    const n = await f.addParticipant(f.e1.id);
    const tags = await Promise.all(Array.from({ length: 10 }, makeTag));
    expect(counts(await parallel(10, (c, i) => assignOn(c, n.id, tags[i]!.publicId)))).toEqual({ ASSIGNED: 1, PARTICIPANT_HAS_TAG: 9 });
  });

  it('T-CONC2-06: 9 parallel replacements for one person leave exactly one active badge', async () => {
    const n = await f.addParticipant(f.e1.id);
    const first = await makeTag();
    await assign(f.staff.vol1, n.id, { publicId: first.publicId });
    const tags = await Promise.all(Array.from({ length: 9 }, makeTag));
    const rs = await parallel(9, (c, i) => assignOn(c, n.id, tags[i]!.publicId, true));
    expect(rs.every((r) => r.code === 'ASSIGNED')).toBe(true);
    const { rows } = await f.pool.query<{ n: number }>('select count(*)::int as n from tag_assignments where participant_id = $1 and ended_at is null', [n.id]);
    expect(rows[0]?.n).toBe(1);
  });
});

describe('tag APIs (PLAN §9.2)', () => {
  const call = async (name: keyof typeof api, jwt: string | null, o: { params?: Record<string, string>; body?: unknown; raw?: string; query?: string; method?: string } = {}) => {
    const res = await api[name](
      new Request(`http://localhost/api/x${o.query ?? ''}`, {
        method: o.method ?? (o.body === undefined && o.raw === undefined ? 'GET' : 'POST'),
        headers: { 'content-type': o.raw === undefined ? 'application/json' : 'text/csv', ...asBearer(jwt) },
        ...(o.body !== undefined && { body: JSON.stringify(o.body) }),
        ...(o.raw !== undefined && { body: o.raw }),
      }),
      { slug: f.slug, ...o.params },
    );
    const type = res.headers.get('content-type') ?? '';
    // Raw bytes for non-JSON: Response.text() strips the CSV's UTF-8 BOM.
    return { status: res.status, body: (type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()).toString('utf8')) as never };
  };

  it('F19: reserve → confirm by API; labels continue the sequence; a bad uid is 400', async () => {
    const r1 = await call('reserve', orgJwt, { body: {} });
    expect(r1.status).toBe(200);
    const { publicId, label, url } = r1.body as { publicId: string; label: string; url: string };
    expect(url).toBe(`${ME_ORIGIN}/t/${publicId}`);
    expect(label).toMatch(/^B-\d{4}$/);
    expect((await call('confirm', orgJwt, { body: { publicId, uid: 'zz' } })).status).toBe(400);
    const webNfcSerial = (freshUid().match(/../g) ?? []).join(':').toLowerCase(); // "04:a1:…" as Web NFC reports it
    expect((await call('confirm', orgJwt, { body: { publicId, uid: webNfcSerial } })).body).toEqual({ code: 'REGISTERED' });
    expect((await call('reserve', volJwt, { body: {} })).status).toBe(403);
  });

  it('T-TAG-13: CSV import gives per-row codes in order; 2,001 rows is 400', async () => {
    const good = freshId();
    const csv = ['public_id,uid,label', `${good},${freshUid()},V-1`, `${good},${freshUid()},V-2`, `nope,${freshUid()},`, `${freshId()},${b.tag.T1.uid},`].join('\n');
    const r = await call('importCsv', orgJwt, { raw: csv });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      results: [
        { row: 1, code: 'REGISTERED' },
        { row: 2, code: 'PUBLIC_ID_CONFLICT' },
        { row: 3, code: 'INVALID:public_id' },
        { row: 4, code: 'UID_CONFLICT' },
      ],
    });
    const big = ['public_id,uid', ...Array.from({ length: 2001 }, () => `${freshId()},${freshUid()}`)].join('\n');
    expect((await call('importCsv', orgJwt, { raw: big })).status).toBe(400);
    expect((await call('importCsv', orgJwt, { raw: 'uid\n04A1B2C3D4E5F6' })).status).toBe(400);
  });

  it('T-TAG-14: export-ids?count=200 reserves 200 unique ids as a CSV via toCsv()', async () => {
    const r = await call('exportIds', orgJwt, { query: '?count=200' });
    expect(r.status).toBe(200);
    const text = r.body as string;
    expect(text.startsWith('﻿"url","public_id","label"\r\n')).toBe(true);
    const lines = text.trim().split('\r\n').slice(1);
    expect(lines).toHaveLength(200);
    const ids = lines.map((l) => l.split(',')[1]?.replaceAll('"', ''));
    expect(new Set(ids).size).toBe(200);
    expect((await call('exportIds', orgJwt, { query: '?count=0' })).status).toBe(400);
    expect((await call('exportIds', orgJwt, { query: '?count=1001' })).status).toBe(400);
  });

  it('PLAN §10.3: the badge list counts registered / linked / unlinked / retired / reserved', async () => {
    const r = await call('list', orgJwt);
    const body = r.body as { counts: Record<string, number>; tags: Array<{ label: string; state: string; holder: string | null }> };
    expect(body.counts.linked).toBeGreaterThanOrEqual(3);
    expect(body.tags.find((t) => t.label === 'T1')).toMatchObject({ state: 'linked', holder: 'Ada Fixture' });
    expect(body.tags.find((t) => t.label === 'T9')).toBeUndefined(); // other event
    expect(JSON.stringify(body)).not.toContain('@');
  });

  it('PLAN §9.2: assign/unassign/stations for staff; validation; other events refused', async () => {
    const n = await f.addParticipant(f.e1.id);
    const t = await makeTag();
    const r = await call('assign', volJwt, { body: { eventSlug: f.slug, participantId: n.id, tagUid: t.uid.match(/../g)?.join(':').toLowerCase() } });
    expect(r.body).toMatchObject({ code: 'ASSIGNED' });
    const undo = await call('unassign', volJwt, { body: { assignmentId: (r.body as { assignmentId: string }).assignmentId } });
    expect(undo.body).toEqual({ code: 'UNASSIGNED' });
    expect((await call('assign', volJwt, { body: { eventSlug: f.slug, participantId: n.id } })).status).toBe(400);
    expect((await call('assign', volJwt, { body: { eventSlug: `${f.slug}-2`, participantId: n.id, tagPublicId: t.publicId } })).status).toBe(403);
    expect((await call('assign', null, { body: { eventSlug: f.slug, participantId: n.id, tagPublicId: t.publicId } })).status).toBe(401);
    expect((await call('setStation', volJwt, { body: { checkpointId: f.cp.L } })).body).toEqual({ code: 'SET' });
    expect((await call('setStation', volJwt, { body: { checkpointId: f.cp.D2 } })).body).toEqual({ code: 'FORBIDDEN' });
    expect((await call('setStation', volJwt, { body: { checkpointId: '00000000-0000-4000-8000-000000000000' } })).body).toEqual({ code: 'CHECKPOINT_NOT_FOUND' });
    const { rows } = await f.pool.query('select checkpoint_id from staff_stations where user_id = $1 and event_id = $2', [f.staff.vol1, f.e1.id]);
    expect(rows).toEqual([{ checkpoint_id: f.cp.L }]);
  });
});

async function makeTag() {
  const publicId = freshId();
  const uid = freshUid();
  const { rows } = await f.pool.query<{ id: string }>('insert into tags (event_id, public_id, uid, registered_by) values ($1, $2, $3, $4) returning id', [
    f.e1.id,
    publicId,
    uid,
    f.staff.org1,
  ]);
  return { id: rows[0]!.id, publicId, uid };
}
