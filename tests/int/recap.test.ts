import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { adminClient, obj } from '../fixtures/admin-api';
import { onlyEmailTo } from '../fixtures/mail';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN F26 / §12.4 (V8): recap_stats, enqueue_recaps, recap preview/send, the recap email.
let f: StandardFixture;
let orgJwt: string;
let volJwt: string;
const admin = adminClient();
const HOUR = 3_600_000;

async function attendee(first: string) {
  const n = await f.addParticipant(f.e1.id);
  await f.pool.query('update participants set first_name = $2 where id = $1', [n.id, first]);
  await f.checkIn(n.id);
  const publicId = randomBytes(9).toString('base64url');
  await f.pool.query('insert into tags (event_id, public_id, registered_by) values ($1, $2, $3)', [f.e1.id, publicId, f.staff.org1]);
  await f.pool.query('select assign_tag($1, $2, $3, $4, null, false)', [f.e1.id, f.staff.org1, n.id, publicId]);
  return { id: n.id, publicId };
}
const emailOf = async (id: string) => (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]?.email ?? '';
const endEvent = (msAgo: number) =>
  f.pool.query('update events set starts_at = $2, ends_at = $3 where id = $1', [f.e1.id, new Date(Date.now() - msAgo - 6 * HOUR), new Date(Date.now() - msAgo)]);

beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 4 });
  orgJwt = await signInAs(f.staffEmail.org1);
  volJwt = await signInAs(f.staffEmail.vol1);
});
afterAll(async () => {
  await f.close();
});

describe('recap_stats (PLAN §12.4)', () => {
  it('counts live workshops and activities, mutual connections and both kinds of points; voided scans excluded', async () => {
    const p = await attendee('Stat');
    const q = await attendee('Pal');
    await f.scan({ cp: f.cp.W, staff: f.staff.vol1, participantId: p.id }); // session, 10 pts
    await f.scan({ cp: f.cp.G, staff: f.staff.vol1, participantId: p.id }); // custom, 5 pts
    const r = await f.scan({ cp: f.cp.R, staff: f.staff.vol1, participantId: p.id }); // custom, voided
    expect((await f.voidScan(r.scanId ?? '', f.staff.vol1)).code).toBe('VOIDED');
    await f.pool.query('select record_connection($1, $2)', [p.id, q.publicId]);
    await f.pool.query('select record_connection($1, $2)', [q.id, p.publicId]);
    const { rows } = await f.pool.query<{ s: unknown }>('select recap_stats($1) as s', [p.id]);
    expect(rows[0]?.s).toEqual({ workshops: 1, activities: 1, connections: 1, activityPoints: 15, networkingPoints: 1 });
  });
});

describe('recap settings, preview and send (PLAN §9.2)', () => {
  it('settings: an unknown placeholder → 400 naming it; a valid message saves; audit has key names only', async () => {
    const bad = await admin.call('updateSettings', orgJwt, { slug: f.slug }, { method: 'PATCH', body: { recapMessage: 'Hi {nickname}, {prize}!' } });
    expect(bad.status).toBe(400);
    expect(obj(bad.body).unknown).toEqual(['{prize}']);
    const ok = await admin.call('updateSettings', orgJwt, { slug: f.slug }, { method: 'PATCH', body: { recapMessage: 'Thanks {nickname}: {workshops} workshops at {event}.' } });
    expect(ok.status).toBe(200);
    expect(obj((await admin.call('getSettings', orgJwt, { slug: f.slug })).body).recapMessage).toBe('Thanks {nickname}: {workshops} workshops at {event}.');
    const { rows } = await f.pool.query<{ detail: unknown }>(`select detail from audit_log where event_id = $1 and action = 'event.settings' order by id desc limit 1`, [f.e1.id]);
    expect(rows[0]?.detail).toEqual({ changed: ['recapMessage'] });
  });

  it('preview: renders for a chosen attendee with a placeholder link (no key issued); another event’s person → 404', async () => {
    await f.checkIn(f.p.A, f.token.A);
    const keysBefore = (await f.pool.query<{ n: number }>('select count(*)::int as n from profile_keys where participant_id = $1', [f.p.A])).rows[0]?.n;
    const r = await admin.call('recapPreview', orgJwt, { slug: f.slug }, { body: { participantId: f.p.A } });
    expect(r.status).toBe(200);
    expect(obj(r.body).subject).toBe(`Thanks for coming to ${f.e1.name}!`);
    expect(String(obj(r.body).text)).toContain(`Thanks Ada: 0 workshops at ${f.e1.name}.`);
    expect(String(obj(r.body).text)).toContain('#preview');
    expect((await f.pool.query<{ n: number }>('select count(*)::int as n from profile_keys where participant_id = $1', [f.p.A])).rows[0]?.n).toBe(keysBefore);
    expect((await admin.call('recapPreview', orgJwt, { slug: f.slug }, { body: { participantId: f.p.X } })).status).toBe(404);
    expect((await admin.call('recapPreview', orgJwt, { slug: f.slug }, { body: {} })).status).toBe(200);
  });

  it('T-RECAP-03: send before ends_at → 409; without an unlock password → 409; volunteer → 403', async () => {
    await f.pool.query('update events set ends_at = $2, badge_unlock_password = null where id = $1', [f.e1.id, new Date(Date.now() + HOUR)]);
    const early = await admin.call('recapSend', orgJwt, { slug: f.slug }, { body: {} });
    expect([early.status, obj(early.body).error]).toEqual([409, 'EVENT_NOT_ENDED']);
    await endEvent(HOUR);
    const noPassword = await admin.call('recapSend', orgJwt, { slug: f.slug }, { body: {} });
    expect([noPassword.status, obj(noPassword.body).error]).toEqual([409, 'NO_UNLOCK_PASSWORD']);
    expect((await admin.call('recapSend', volJwt, { slug: f.slug }, { body: {} })).status).toBe(403);
    expect((await f.pool.query<{ n: number }>(`select count(*)::int as n from email_outbox o join participants p on p.id = o.participant_id where p.event_id = $1 and o.kind = 'recap'`, [f.e1.id])).rows[0]?.n).toBe(0);
  });
});

describe('enqueue_recaps and the recap email (PLAN §15.10)', () => {
  it('T-RECAP-01 / T-RECAP-02: a volunteer gets −1; an organizer queues every checked-in, eligible, non-test person, then 0', async () => {
    await f.checkIn(f.p.T); // test participant: never gets a recap
    expect((await f.pool.query<{ n: number }>('select enqueue_recaps($1, $2) as n', [f.e1.id, f.staff.vol1])).rows[0]?.n).toBe(-1);
    const { rows: expected } = await f.pool.query<{ n: number }>(
      `select count(distinct s.participant_id)::int as n from scans s join checkpoints c on c.id = s.checkpoint_id and c.kind = 'door'
         join participants p on p.id = s.participant_id
        where s.event_id = $1 and s.voided_at is null and not p.is_test and p.status = 'accepted' and p.deleted_at is null`,
      [f.e1.id],
    );
    expect(expected[0]?.n).toBeGreaterThanOrEqual(3); // A, Stat, Pal
    expect((await f.pool.query<{ n: number }>('select enqueue_recaps($1, $2) as n', [f.e1.id, f.staff.org1])).rows[0]?.n).toBe(expected[0]?.n);
    expect((await f.pool.query<{ n: number }>('select enqueue_recaps($1, $2) as n', [f.e1.id, f.staff.org1])).rows[0]?.n).toBe(0);
    expect((await f.pool.query(`select 1 from email_outbox where participant_id = $1 and kind = 'recap'`, [f.p.T])).rowCount).toBe(0);
  });

  it('T-RECAP-05: the drained recap has a fresh edit link with next=/me/connections that opens a session, the password, NFC steps and stats', async () => {
    await f.pool.query(`update events set badge_unlock_password = 'tap-tap-42' where id = $1`, [f.e1.id]);
    await admin.drain();
    const m = onlyEmailTo(admin.mail.sent, await emailOf(f.p.A));
    expect(m.subject).toBe(`Thanks for coming to ${f.e1.name}!`);
    const key = /\/edit\?next=\/me\/connections#([A-Za-z0-9_-]{43})/.exec(m.text)?.[1] ?? '';
    expect(key).toHaveLength(43);
    expect(m.html).toContain('tap-tap-42');
    expect(m.text).toContain('tap-tap-42');
    expect(m.text).toMatch(/NFC Tools/);
    expect(m.text).toContain(`Thanks Ada: 0 workshops at ${f.e1.name}.`);
    const opened = await f.pool.query<{ r: { code: string } }>(`select open_profile_session($1, $2, interval '1 day') as r`, [sha256hex(key), sha256hex(generateSecret())]);
    expect(opened.rows[0]?.r.code).toBe('OPENED');
    expect((await admin.call('recapSend', orgJwt, { slug: f.slug }, { body: {} })).body).toEqual({ queued: 0 }); // safe to press twice
  });
});
