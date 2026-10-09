import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient } from '../fixtures/admin-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type Badges, type StandardFixture } from '../fixtures/standard';

// PLAN §6.6 (V5a): record_scan with badges, numbered meal servings, points. SQL through the fixture.
let f: StandardFixture;
let b: Badges;
let orgJwt: string;
const admin = adminClient();

beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 4 });
  b = await f.addBadges(); // A wears T1, B wears T2, org1's badge row wears T3
  orgJwt = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

const tag = (n: 'T4' | 'T5' | 'T6' | 'T7' | 'T8') => b.tag[n];

describe('badge scans (PLAN §15.7 T-SCAN2)', () => {
  it('T-SCAN2-01 / T-SCAN2-02: a badge at G (no check-in, 5 points) → ACCEPTED with points; again → ALREADY_SCANNED', async () => {
    const r = await f.tapBadge(f.staff.vol1, f.cp.G, b.tag.T1);
    expect(r).toMatchObject({ code: 'ACCEPTED', replayed: false, points: 5, servingNo: 1, participant: { id: f.p.A, badgeRole: 'participant' } });
    const { rows } = await f.pool.query('select method, tag_id, pass_id from scans where id = $1', [r.scanId]);
    expect(rows).toEqual([{ method: 'nfc', tag_id: b.tag.T1.id, pass_id: null }]);
    expect((await f.tapBadge(f.staff.vol1, f.cp.G, b.tag.T1)).code).toBe('ALREADY_SCANNED');
  });

  it('T-SCAN2-03: a badge at Lunch before the door → NOT_CHECKED_IN', async () => {
    expect((await f.tapBadge(f.staff.vol1, f.cp.L, b.tag.T2)).code).toBe('NOT_CHECKED_IN');
  });

  it('T-SCAN2-04: by chip serial gives the same results as by URL', async () => {
    expect((await f.tapBadge(f.staff.vol1, f.cp.R, b.tag.T2, { byUid: true })).code).toBe('ACCEPTED');
    expect((await f.tapBadge(f.staff.vol1, f.cp.R, b.tag.T2)).code).toBe('ALREADY_SCANNED');
  });

  it('T-SCAN2-05 / 06 / 07: unlinked badge, another event’s badge, unknown badge', async () => {
    expect(await f.tapBadge(f.staff.vol1, f.cp.D, tag('T4'))).toMatchObject({ code: 'TAG_UNASSIGNED', tagId: tag('T4').id, tagLabel: 'T4' });
    const wrong = await f.tapBadge(f.staff.vol1, f.cp.D, b.tag.T9);
    expect(wrong).toEqual({ code: 'WRONG_EVENT', otherEvent: f.e2.name });
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, tagPublicId: 'AAAAAAAAAAAA' })).code).toBe('NOT_FOUND');
  });

  it('T-SCAN2-08: a replaced badge → TAG_REPLACED with the name; the new badge at a done checkpoint → ALREADY_SCANNED', async () => {
    const n = await f.addParticipant(f.e1.id);
    await f.pool.query('select assign_tag($1, $2, $3, $4, null, false)', [f.e1.id, f.staff.org1, n.id, tag('T5').publicId]);
    expect((await f.tapBadge(f.staff.vol1, f.cp.R, tag('T5'))).code).toBe('ACCEPTED');
    await f.pool.query('select assign_tag($1, $2, $3, $4, null, true)', [f.e1.id, f.staff.org1, n.id, tag('T6').publicId]);
    expect(await f.tapBadge(f.staff.vol1, f.cp.R, tag('T5'))).toMatchObject({ code: 'TAG_REPLACED', participant: { id: n.id, displayName: 'Extra Fixture' }, retiredAt: expect.any(String) });
    expect((await f.tapBadge(f.staff.vol1, f.cp.R, tag('T6'))).code).toBe('ALREADY_SCANNED');
  });

  it('T-SCAN2-09: QR regressions through the new signature', async () => {
    expect(await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.rvOldToken })).toMatchObject({ code: 'REVOKED', reissued: true });
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.X })).code).toBe('WRONG_EVENT');
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, participantId: f.p.C })).code).toBe('NOT_ACCEPTED');
    const w = await f.addParticipant(f.e1.id);
    const x = await f.addParticipant(f.e1.id);
    const y = await f.addParticipant(f.e1.id);
    for (const p of [w, x, y]) await f.checkIn(p.id);
    expect((await f.scan({ cp: f.cp.W, staff: f.staff.vol1, participantId: w.id })).code).toBe('ACCEPTED');
    expect((await f.scan({ cp: f.cp.W, staff: f.staff.vol1, participantId: x.id })).code).toBe('ACCEPTED');
    expect(await f.scan({ cp: f.cp.W, staff: f.staff.vol1, participantId: y.id })).toMatchObject({ code: 'CAPACITY_REACHED', capacity: 2 });
    expect((await f.scan({ cp: f.cp.W, staff: f.staff.vol1, participantId: w.id })).code).toBe('ALREADY_SCANNED'); // already beats full
  });

  it('T-SCAN2-10: walk-in with check-in through the re-created add_walk_in', async () => {
    const { rows } = await f.pool.query<{ r: { code: string; scan: { code: string } } }>(
      `select add_walk_in($1, $2, $3, 'Walk', 'In', 'walk in', true, false) as r`,
      [f.e1.id, f.staff.org1, `walk-${randomUUID().slice(0, 8)}@${f.slug}.test`],
    );
    expect(rows[0]?.r).toMatchObject({ code: 'CREATED', scan: { code: 'ACCEPTED' } });
  });

  it('T-SCAN2-12: the old 7-argument record_scan no longer exists', async () => {
    const { rows } = await f.pool.query<{ sig: string }>(`select p.oid::regprocedure::text as sig from pg_proc p where p.proname = 'record_scan'`);
    expect(rows.map((r) => r.sig)).toEqual(['record_scan(uuid,uuid,scan_method,text,uuid,text,text,uuid,timestamp with time zone,boolean)']);
  });

  it('T-SCAN2-13: a raw nfc scan without tag_id violates scans_nfc_has_tag', async () => {
    await expect(
      f.pool.query(`insert into scans (event_id, participant_id, checkpoint_id, method, scanned_by, client_scan_id) values ($1, $2, $3, 'nfc', $4, $5)`, [
        f.e1.id,
        f.p.N,
        f.cp.R,
        f.staff.org1,
        randomUUID(),
      ]),
    ).rejects.toThrow(/scans_nfc_has_tag/);
  });
});

describe('meal servings (PLAN F22, T-MEAL)', () => {
  it('T-MEAL-01…03: first serving with dietary notes; repeat → REPEAT_SERVING; confirm → serving 2', async () => {
    await f.checkIn(f.p.A, f.token.A);
    const first = await f.tapBadge(f.staff.vol1, f.cp.L, b.tag.T1);
    expect(first).toMatchObject({ code: 'ACCEPTED', servingNo: 1, points: 0, participant: { dietaryNotes: 'Vegetarian' } });
    const again = await f.tapBadge(f.staff.vol2, f.cp.L, b.tag.T1);
    expect(again).toMatchObject({ code: 'REPEAT_SERVING', servedCount: 1, previous: { scannedByName: 'Vol One', scannedByMe: false } });
    const confirmed = await f.tapBadge(f.staff.vol2, f.cp.L, b.tag.T1, { confirmRepeat: true });
    expect(confirmed).toMatchObject({ code: 'ACCEPTED', servingNo: 2 });
  });

  it('T-MEAL-04: with Seconds open, repeats go straight to ACCEPTED, still numbered', async () => {
    const meal = (await f.pool.query<{ id: string }>(`insert into checkpoints (event_id, name, kind, is_open, seconds_open) values ($1, $2, 'meal', true, true) returning id`, [f.e1.id, `Dinner ${randomUUID().slice(0, 6)}`])).rows[0]?.id ?? '';
    await f.checkIn(f.p.N);
    expect((await f.scan({ cp: meal, staff: f.staff.vol1, participantId: f.p.N })).servingNo).toBe(1);
    expect(await f.scan({ cp: meal, staff: f.staff.vol1, participantId: f.p.N })).toMatchObject({ code: 'ACCEPTED', servingNo: 2 });
  });

  it('T-MEAL-05: voiding serving 3 and serving again gives 4; numbers are never reused', async () => {
    const n = await f.addParticipant(f.e1.id);
    await f.checkIn(n.id);
    const s1 = await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: n.id });
    await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: n.id, confirmRepeat: true });
    const s3 = await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: n.id, confirmRepeat: true });
    expect([s1.servingNo, s3.servingNo]).toEqual([1, 3]);
    expect((await f.voidScan(s3.scanId ?? '', f.staff.vol1)).code).toBe('VOIDED');
    expect((await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: n.id, confirmRepeat: true })).servingNo).toBe(4);
  });
});

describe('checkpoint rules (PLAN §6.6)', () => {
  it('T-EVT-12: meals can’t have points; Seconds open is for meals only (DB and API)', async () => {
    await expect(f.pool.query(`insert into checkpoints (event_id, name, kind, points) values ($1, 'Snack x', 'meal', 5)`, [f.e1.id])).rejects.toThrow(/checkpoints_meal_no_points/);
    await expect(f.pool.query(`insert into checkpoints (event_id, name, kind, seconds_open) values ($1, 'Booth x', 'custom', true)`, [f.e1.id])).rejects.toThrow(/checkpoints_meal_rules/);
    const bad1 = await admin.call('createCheckpoint', orgJwt, { slug: f.slug }, { body: { name: 'Snack y', kind: 'meal', points: 5 } });
    const bad2 = await admin.call('createCheckpoint', orgJwt, { slug: f.slug }, { body: { name: 'Booth y', kind: 'custom', secondsOpen: true } });
    expect([bad1.status, bad2.status]).toEqual([400, 400]);
    const ok = await admin.call('createCheckpoint', orgJwt, { slug: f.slug }, { body: { name: 'Hack talk', kind: 'session', points: 20 } });
    expect(ok.status).toBe(201);
    const { rows } = await f.pool.query('select points, seconds_open from checkpoints where event_id = $1 and name = $2', [f.e1.id, 'Hack talk']);
    expect(rows).toEqual([{ points: 20, seconds_open: false }]);
  });
});
