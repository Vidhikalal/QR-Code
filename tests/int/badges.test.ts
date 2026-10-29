import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, obj } from '../fixtures/admin-api';
import { scanApi } from '../fixtures/scan-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §6.5 / §8 (NFC note) / §14.15. Badge links per event, NFC scans through record_badge_scan().
let f: StandardFixture;
const c = adminClient();
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

describe('staff badge links (SPEC §6.5, v0.10)', () => {
  it('T-NFC-27: an organizer unlinks a badge, stopping badge scans and public profile access; relinking works', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const { uid } = await f.linkBadge(id);
    const unlink = () => c.call('unlinkBadge', org1, { slug: f.slug, id }, { method: 'DELETE' });
    const profile = async () => (await f.pool.query('select badge_profile($1) as profile', [uid])).rows[0]?.profile;
    expect(await profile()).not.toBeNull();
    expect(await unlink()).toMatchObject({ status: 200, body: { code: 'UNLINKED' } });
    expect((await f.badgeScan({ cp: f.cp.R, staff: f.staff.vol1, uid })).code).toBe('NOT_FOUND');
    expect(await profile()).toBeNull();
    expect(await unlink()).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
    const audit = await f.pool.query(
      `select event_id, actor_user_id, actor_kind, detail from audit_log where action = 'badge.unlink' and subject_id = $1`,
      [id],
    );
    expect(audit.rows).toEqual([{ event_id: f.e1.id, actor_user_id: f.staff.org1, actor_kind: 'staff', detail: {} }]);
    expect((await f.linkBadge(id, { uid })).code).toBe('LINKED');
    expect((await f.badgeScan({ cp: f.cp.R, staff: f.staff.vol1, uid })).code).toBe('ACCEPTED');
    expect(await profile()).not.toBeNull();
  });

  it('T-NFC-27: unlink requires an organizer of this event and a valid participant in it', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const { uid } = await f.linkBadge(id);
    const other = await f.addParticipant(f.e2.id);
    const otherBadge = await f.linkBadge(other.id, { actor: f.staff.vol3 });
    const unlink = (jwt: string | null, participantId: string) =>
      c.call('unlinkBadge', jwt, { slug: f.slug, id: participantId }, { method: 'DELETE' });
    expect((await unlink(null, id)).status).toBe(401);
    expect((await unlink(vol1, id)).status).toBe(403);
    expect((await unlink(vol3, id)).status).toBe(403);
    for (const missing of [other.id, crypto.randomUUID(), 'not-a-uuid']) {
      expect(await unlink(org1, missing)).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
    }
    const badges = await f.pool.query('select uid from badges where participant_id in ($1, $2)', [id, other.id]);
    expect(badges.rows.map((b) => b.uid).sort()).toEqual([uid, otherBadge.uid].sort());
    expect((await f.pool.query(`select 1 from audit_log where action = 'badge.unlink' and subject_id in ($1, $2)`, [id, other.id])).rows).toEqual([]);
  });

  it('T-NFC-27: participant lists and manual search report whether a badge is linked', async () => {
    const flags = async (hasBadge: boolean) => {
      const list = await c.call('listParticipants', org1, { slug: f.slug }, { query: { q: 'ada fixture' } });
      expect(list.status).toBe(200);
      expect(obj(list.body).participants).toEqual([expect.objectContaining({ id: f.p.A, hasBadge })]);
      for (const staff of [org1, vol1]) {
        const search = await api.search(staff, f.slug, 'ada fixture');
        expect(search.status).toBe(200);
        expect(search.body.results).toContainEqual(expect.objectContaining({ id: f.p.A, hasBadge }));
      }
    };
    await flags(false);
    await f.linkBadge(f.p.A);
    await flags(true);
    expect((await c.call('unlinkBadge', org1, { slug: f.slug, id: f.p.A }, { method: 'DELETE' })).status).toBe(200);
    await flags(false);
  });

  it('T-NFC-27: the participants list still knows who has a badge when the event holds over 1,000 of them', async () => {
    // A separate query for the event's badges stops at the API's 1,000-row cap; the flag must come with each row.
    const { rows } = await f.pool.query<{ n: number }>(
      `with bulk as (
         insert into participants (event_id, email, first_name, search_text, status, source)
         select $1, 'bulk-' || g || '-' || $2 || '@example.test', 'Bulk', 'bulk', 'accepted', 'seed' from generate_series(1, 1001) g
         returning id)
       insert into badges (uid, event_id, participant_id) select substr(md5(id::text), 1, 14), $1, id from bulk returning 1`,
      [f.e1.id, randomUid()],
    );
    expect(rows).toHaveLength(1001);
    await f.linkBadge(f.p.B); // linked after the 1,001 others
    const list = await c.call('listParticipants', org1, { slug: f.slug }, { query: { q: 'ben fixture' } });
    expect(obj(list.body).participants).toEqual([expect.objectContaining({ id: f.p.B, hasBadge: true })]);
  });

  it('T-NFC-27: claim_badge no longer exists', async () => {
    const { rows } = await f.pool.query(
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'claim_badge'`,
    );
    expect(rows).toEqual([]);
  });
});

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
