import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanApi } from '../fixtures/scan-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §6.5 / §8 (NFC note) / §14.15. Badge links per event, NFC scans through record_badge_scan().
let f: StandardFixture;
let api: ReturnType<typeof scanApi>;
let org1: string;
let vol1: string;
let vol3: string;
beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 12 });
  api = scanApi();
  [org1, vol1, vol3] = await Promise.all([signInAs(f.staffEmail.org1), signInAs(f.staffEmail.vol1), signInAs(f.staffEmail.vol3)]);
});
afterAll(async () => {
  await f.close();
});

const liveScans = async (participantId: string) =>
  (await f.pool.query<{ method: string; pass_id: string | null; checkpoint_id: string }>(
    'select method, pass_id, checkpoint_id from scans where participant_id = $1 and voided_at is null',
    [participantId],
  )).rows;

describe('NFC scans (SPEC §8 NFC note)', () => {
  it('T-NFC-03: a linked badge follows the same rules as a QR pass', async () => {
    const a = await f.linkBadge(f.p.A);
    expect(a.code).toBe('LINKED');
    expect((await f.badgeScan({ cp: f.cp.D, staff: f.staff.vol1, uid: a.uid })).code).toBe('ACCEPTED');
    expect(await liveScans(f.p.A)).toEqual([{ method: 'nfc', pass_id: null, checkpoint_id: f.cp.D }]);
    const again = await f.badgeScan({ cp: f.cp.D, staff: f.staff.vol2, uid: a.uid });
    expect(again.code).toBe('ALREADY_SCANNED');
    expect(again.previous?.scannedByName).toBe('Vol One');

    const c = await f.linkBadge(f.p.C);
    expect((await f.badgeScan({ cp: f.cp.D, staff: f.staff.vol1, uid: c.uid })).code).toBe('NOT_ACCEPTED');

    const b = await f.linkBadge(f.p.B);
    expect((await f.badgeScan({ cp: f.cp.L, staff: f.staff.vol1, uid: b.uid })).code).toBe('NOT_CHECKED_IN');

    expect((await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.A })).code).toBe('ACCEPTED');
    expect((await f.badgeScan({ cp: f.cp.R, staff: f.staff.vol1, uid: a.uid })).code).toBe('ALREADY_SCANNED');
  });

  it('T-NFC-03: /api/scan with method nfc records the scan and logs the attempt', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const { uid } = await f.linkBadge(id);
    const res = await api.scan(vol1, { checkpointId: f.cp.R, method: 'nfc', badgeUid: uid });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('ACCEPTED');
    expect((res.body.participant as { id: string }).id).toBe(id);
    const { rows } = await f.pool.query('select result_code from scan_attempts where participant_id = $1', [id]);
    expect(rows).toEqual([{ result_code: 'ACCEPTED' }]);
  });

  it('T-NFC-04: unknown badge and another event’s badge → NOT_FOUND without leaking the other event; other-event staff → FORBIDDEN', async () => {
    const before = (await f.pool.query('select count(*)::int as n from scans where checkpoint_id = $1', [f.cp.D])).rows[0];
    expect((await f.badgeScan({ cp: f.cp.D, staff: f.staff.vol1, uid: randomUid() })).code).toBe('NOT_FOUND');

    const x = await f.linkBadge(f.p.X, { actor: f.staff.vol3 });
    expect(x.code).toBe('LINKED');
    const wrong = await f.badgeScan({ cp: f.cp.D, staff: f.staff.vol1, uid: x.uid });
    expect(wrong).toEqual({ code: 'NOT_FOUND' });
    const after = (await f.pool.query('select count(*)::int as n from scans where checkpoint_id = $1', [f.cp.D])).rows[0];
    expect(after).toEqual(before);

    const { id } = await f.addParticipant(f.e1.id);
    const { uid } = await f.linkBadge(id);
    expect((await f.badgeScan({ cp: f.cp.D, staff: f.staff.vol3, uid })).code).toBe('FORBIDDEN');
  });
});

describe('POST /api/events/[slug]/badges (SPEC §6.5, §9.3)', () => {
  it('T-NFC-05: volunteers link free badges, organizers move taken ones, everything else is refused', async () => {
    const one = await f.addParticipant(f.e1.id);
    const two = await f.addParticipant(f.e1.id);
    const first = randomUid();
    const second = randomUid();

    const linked = await api.linkBadge(vol1, f.slug, { participantId: one.id, uid: first });
    expect(linked).toEqual({ status: 200, body: { code: 'LINKED' } });
    const audit = await f.pool.query<{ actor_user_id: string; detail: unknown }>(
      `select actor_user_id, detail from audit_log where action = 'badge.link' and subject_id = $1`,
      [one.id],
    );
    expect(audit.rows).toEqual([{ actor_user_id: f.staff.vol1, detail: {} }]);

    // Relinking a participant replaces their old badge.
    expect((await api.linkBadge(vol1, f.slug, { participantId: one.id, uid: second })).body).toEqual({ code: 'LINKED' });
    expect((await f.badgeScan({ cp: f.cp.R, staff: f.staff.vol1, uid: first })).code).toBe('NOT_FOUND');

    // A badge linked to someone else: a volunteer can't take it, an organizer moves it.
    expect((await api.linkBadge(vol1, f.slug, { participantId: two.id, uid: second })).body).toEqual({ code: 'BADGE_TAKEN' });
    expect((await api.linkBadge(org1, f.slug, { participantId: two.id, uid: second })).body).toEqual({ code: 'LINKED' });
    const moved = await f.badgeScan({ cp: f.cp.R, staff: f.staff.vol1, uid: second });
    expect(moved.participant?.id).toBe(two.id);

    expect((await api.linkBadge(org1, f.slug, { participantId: f.p.X, uid: randomUid() })).body).toEqual({ code: 'NOT_FOUND' });
    expect((await api.linkBadge(vol3, f.slug, { participantId: one.id, uid: randomUid() })).status).toBe(403);
    expect((await api.linkBadge(null, f.slug, { participantId: one.id, uid: randomUid() })).status).toBe(401);
    expect((await api.linkBadge(vol1, f.slug, { participantId: one.id, uid: '04A1B2C3D4E5F6' })).status).toBe(400);
    expect((await api.linkBadge(vol1, f.slug, { participantId: one.id, uid: randomUid(), extra: 1 })).status).toBe(400);
  });

  it('T-NFC-06: deleting (tombstoning) a participant removes their badge link', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const { uid } = await f.linkBadge(id);
    await f.pool.query('select delete_participant($1, $2, $3)', [f.e1.id, id, f.staff.org1]);
    expect((await f.pool.query('select 1 from badges where participant_id = $1', [id])).rows).toHaveLength(0);
    expect((await f.badgeScan({ cp: f.cp.R, staff: f.staff.vol1, uid })).code).toBe('NOT_FOUND');
  });

  it('T-NFC-06: revoking a pass also unlinks the badge, so it stops working', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const { uid } = await f.linkBadge(id);
    const { rows } = await f.pool.query<{ r: string }>('select revoke_pass($1, $2, $3) as r', [f.e1.id, id, f.staff.org1]);
    expect(rows[0]?.r).toBe('REVOKED');
    expect((await f.pool.query('select 1 from badges where participant_id = $1', [id])).rows).toHaveLength(0);
    expect((await f.badgeScan({ cp: f.cp.R, staff: f.staff.vol1, uid })).code).toBe('NOT_FOUND');
  });

  it('T-NFC-07: the database rejects bad UIDs, a second badge per participant, and cross-event links', async () => {
    const insert = (uid: string, eventId: string, participantId: string) =>
      f.pool.query('insert into badges (uid, event_id, participant_id) values ($1, $2, $3)', [uid, eventId, participantId]);
    const { id } = await f.addParticipant(f.e1.id);
    await expect(insert('04A1B2C3', f.e1.id, id)).rejects.toMatchObject({ code: '23514' });
    await expect(insert('04a1b2c', f.e1.id, id)).rejects.toMatchObject({ code: '23514' });
    await insert(randomUid(), f.e1.id, id);
    await expect(insert(randomUid(), f.e1.id, id)).rejects.toMatchObject({ code: '23505' });
    const other = await f.addParticipant(f.e2.id); // fresh: X already holds a badge from T-NFC-04
    await expect(insert(randomUid(), f.e1.id, other.id)).rejects.toMatchObject({ code: '23503' });
  });

  // 20 rounds: the window (another link committing between the TAKEN check and the write) is small.
  it('T-NFC-08: ten parallel volunteer links of one badge → exactly one wins', async () => {
    const people = await Promise.all(Array.from({ length: 10 }, () => f.addParticipant(f.e1.id)));
    for (let round = 0; round < 20; round += 1) {
      const uid = randomUid();
      const results = await Promise.all(people.map((p) => f.linkBadge(p.id, { uid, actor: f.staff.vol1 })));
      const codes = results.map((r) => r.code);
      expect(codes.filter((c) => c === 'LINKED'), `round ${round}`).toHaveLength(1);
      expect(codes.filter((c) => c === 'BADGE_TAKEN'), `round ${round}`).toHaveLength(9);
      expect((await f.pool.query('select 1 from badges where uid = $1', [uid])).rows).toHaveLength(1);
    }
  });

  // Each link deletes its own old row, then waits on the other's uncommitted delete in the unique
  // check: without serialization the two transactions deadlock and one becomes a 500.
  it('T-NFC-08: two badges swapped at the same moment never error (no deadlock)', async () => {
    const [a, b] = await Promise.all([f.addParticipant(f.e1.id), f.addParticipant(f.e1.id)]);
    for (let round = 0; round < 30; round += 1) {
      const [x, y] = [randomUid(), randomUid()];
      await f.linkBadge(a.id, { uid: x });
      await f.linkBadge(b.id, { uid: y });
      for (const move of [false, true]) {
        const results = await Promise.all([
          f.linkBadge(a.id, { uid: y, actor: f.staff.vol1, move }),
          f.linkBadge(b.id, { uid: x, actor: f.staff.vol1, move }),
        ]);
        for (const r of results) expect(['LINKED', 'BADGE_TAKEN'], `round ${round}`).toContain(r.code);
      }
    }
  });
});

describe('claim_badge() (SPEC §6.5, v0.5)', () => {
  const emailOf = async (id: string) =>
    (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]?.email ?? '';
  // The account id only goes into audit_log; any real user will do here.
  const claim = async (uid: string, email: string, eventId = f.e1.id) =>
    (await f.pool.query<{ code: string }>('select claim_badge($1, $2, $3, $4) as code', [uid, eventId, email, f.staff.vol1])).rows[0]?.code;
  const holder = async (uid: string) =>
    (await f.pool.query<{ participant_id: string }>('select participant_id from badges where uid = $1', [uid])).rows.map((r) => r.participant_id);

  it('T-NFC-20: an attendee claims an unlinked badge; it scans as them, and a second badge replaces the first', async () => {
    const a = await f.addParticipant(f.e1.id);
    const first = randomUid();
    expect(await claim(first, await emailOf(a.id))).toBe('LINKED');
    expect((await f.badgeScan({ cp: f.cp.R, staff: f.staff.vol1, uid: first })).code).toBe('ACCEPTED');
    const { rows } = await f.pool.query<{ actor_kind: string; detail: unknown }>(
      `select actor_kind, detail from audit_log where action = 'badge.claim' and subject_id = $1`,
      [a.id],
    );
    expect(rows).toEqual([{ actor_kind: 'participant', detail: {} }]); // no UID, no PII (I-11)

    const second = randomUid();
    expect(await claim(second, ` ${(await emailOf(a.id)).toUpperCase()} `)).toBe('LINKED');
    expect(await holder(first)).toEqual([]);
    expect(await holder(second)).toEqual([a.id]);
  });

  it('T-NFC-20: someone else’s badge → BADGE_TAKEN; anyone who isn’t an accepted attendee of that event → NOT_FOUND', async () => {
    const { uid } = await f.linkBadge(f.p.A);
    const b = await f.addParticipant(f.e1.id);
    const own = randomUid();
    expect(await claim(own, await emailOf(b.id))).toBe('LINKED');
    expect(await claim(uid, await emailOf(b.id))).toBe('BADGE_TAKEN');
    expect(await holder(uid)).toEqual([f.p.A]);
    expect(await holder(own)).toEqual([b.id]); // the refused claim didn't drop B's own badge

    const gone = await f.addParticipant(f.e1.id);
    const goneEmail = await emailOf(gone.id);
    await f.pool.query('update participants set deleted_at = now() where id = $1', [gone.id]);
    for (const email of [await emailOf(f.p.C), await emailOf(f.p.Wd), await emailOf(f.p.X), goneEmail, f.staffEmail.org1]) {
      expect(await claim(randomUid(), email), email).toBe('NOT_FOUND');
    }

    const { rows } = await f.pool.query<{ id: string }>(
      `insert into events (slug, name, venue, starts_at, ends_at)
       values ($1, 'Old Event', 'Old Hall', now() - interval '40 days', now() - interval '31 days') returning id`,
      [`${f.slug}-claim-old`],
    );
    const oldEvent = rows[0]?.id ?? '';
    const late = await f.addParticipant(oldEvent);
    expect(await claim(randomUid(), await emailOf(late.id), oldEvent)).toBe('NOT_FOUND');
    await f.pool.query(`update events set ends_at = now() - interval '29 days' where id = $1`, [oldEvent]);
    expect(await claim(randomUid(), await emailOf(late.id), oldEvent)).toBe('LINKED');
  });

  it('T-NFC-20: ten attendees claiming one badge at the same moment → exactly one wins', async () => {
    const people = await Promise.all(Array.from({ length: 10 }, () => f.addParticipant(f.e1.id)));
    const emails = await Promise.all(people.map((p) => emailOf(p.id)));
    for (let round = 0; round < 20; round += 1) {
      const uid = randomUid();
      const codes = await Promise.all(emails.map((e) => claim(uid, e)));
      expect(codes.filter((c) => c === 'LINKED'), `round ${round}`).toHaveLength(1);
      expect(codes.filter((c) => c === 'BADGE_TAKEN'), `round ${round}`).toHaveLength(9);
    }
  });
});
