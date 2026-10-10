import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { runRetention } from '@/lib/privacy/retention';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, type Badges, type StandardFixture } from '../fixtures/standard';

// PLAN F26.3 / T-SEC2-07 (V8): after ends_at + profile_retention_days, profiles, connection taps,
// sign-in codes and sessions are deleted and edit keys revoked; tags, links and scans stay.
let f: StandardFixture;
let b: Badges;
const DAY = 86_400_000;

async function profileWithSession(id: string) {
  const key = generateSecret();
  await f.pool.query('select issue_profile_key($1, $2)', [id, sha256hex(key)]);
  await f.pool.query(`select open_profile_session($1, $2, interval '30 days')`, [sha256hex(key), sha256hex(generateSecret())]);
}
type Counts = { profiles: number; keys: number; sessions: number; codes: number; taps: number; tags: number; links: number; scans: number };
async function counts(eventId: string): Promise<Counts> {
  const { rows } = await f.pool.query<Counts>(
    `select (select count(*)::int from profiles pr join participants p on p.id = pr.participant_id where p.event_id = $1) as profiles,
            (select count(*)::int from profile_keys k join participants p on p.id = k.participant_id where p.event_id = $1 and k.revoked_at is null) as keys,
            (select count(*)::int from participant_sessions s join participants p on p.id = s.participant_id where p.event_id = $1) as sessions,
            (select count(*)::int from signin_codes c join participants p on p.id = c.participant_id where p.event_id = $1) as codes,
            (select count(*)::int from connection_taps where event_id = $1) as taps,
            (select count(*)::int from tags where event_id = $1) as tags,
            (select count(*)::int from tag_assignments where event_id = $1) as links,
            (select count(*)::int from scans where event_id = $1) as scans`,
    [eventId],
  );
  return rows[0] as Counts;
}
const retain = async (eventId: string) => (await f.pool.query<{ r: Record<string, unknown> }>('select retain_event_profiles($1) as r', [eventId])).rows[0]?.r;

beforeAll(async () => {
  f = await createStandardFixture();
  b = await f.addBadges(); // A wears T1, B wears T2
  await f.checkIn(f.p.A, f.token.A);
  await f.checkIn(f.p.B, f.token.B);
  await profileWithSession(f.p.A);
  await profileWithSession(f.p.B);
  await f.pool.query(`select issue_signin_code($1, $2, 'staff_handoff', $3)`, [f.p.A, sha256hex(randomBytes(16).toString('base64url')), f.staff.org1]);
  await f.pool.query('select record_connection($1, $2)', [f.p.A, b.tag.T2.publicId]);
  await f.pool.query('select record_connection($1, $2)', [f.p.B, b.tag.T1.publicId]);
});
afterAll(async () => {
  await f.close();
});

describe('retention v2 (PLAN F26.3)', () => {
  it('T-SEC2-07: before ends_at + retention days → NOT_DUE and nothing changes', async () => {
    const before = await counts(f.e1.id);
    expect(before).toMatchObject({ profiles: 3, sessions: 2, codes: 1, taps: 2 }); // A, B and org1's own badge row
    await f.pool.query('update events set starts_at = $2, ends_at = $3, profile_retention_days = 30 where id = $1', [f.e1.id, new Date(Date.now() - 30 * DAY), new Date(Date.now() - 29 * DAY)]);
    expect(await retain(f.e1.id)).toEqual({ code: 'NOT_DUE' });
    expect(await counts(f.e1.id)).toEqual(before);
  });

  it('T-SEC2-07: when due, profiles/taps/codes/sessions go, keys are revoked (retention), tags/links/scans stay; a second run is all zeros', async () => {
    const before = await counts(f.e1.id);
    await f.pool.query('update events set starts_at = $2, ends_at = $3, profile_retention_days = 1 where id = $1', [f.e1.id, new Date(Date.now() - 3 * DAY), new Date(Date.now() - 2 * DAY)]);
    expect(await retain(f.e1.id)).toEqual({ code: 'RETAINED', profiles: before.profiles, keys: before.keys, sessions: 2, codes: 1, taps: 2 });
    expect(await counts(f.e1.id)).toEqual({ ...before, profiles: 0, keys: 0, sessions: 0, codes: 0, taps: 0 });
    const { rows } = await f.pool.query<{ n: number }>(
      `select count(*)::int as n from profile_keys k join participants p on p.id = k.participant_id where p.event_id = $1 and k.revoke_reason = 'retention'`,
      [f.e1.id],
    );
    expect(rows[0]?.n).toBe(before.keys);
    expect(await retain(f.e1.id)).toEqual({ code: 'RETAINED', profiles: 0, keys: 0, sessions: 0, codes: 0, taps: 0 });
    const audit = await f.pool.query<{ detail: Record<string, unknown> }>(`select detail from audit_log where event_id = $1 and action = 'privacy.profile_retention' order by id`, [f.e1.id]);
    expect(audit.rows.map((r) => Object.keys(r.detail).sort())).toEqual([['codes', 'keys', 'profiles', 'sessions', 'taps']]); // none for the empty rerun
  });

  it('T-SEC2-07: runRetention applies it to every due event (here E2) and reports counts', async () => {
    await profileWithSession(f.p.X);
    await f.pool.query('update events set starts_at = $2, ends_at = $3, profile_retention_days = 1 where id = $1', [f.e2.id, new Date(Date.now() - 3 * DAY), new Date(Date.now() - 2 * DAY)]);
    const report = await runRetention(serviceClient(), new Date());
    expect(report.profiles.find((e) => e.eventId === f.e2.id)).toMatchObject({ profiles: 1, sessions: 1 });
    expect((await counts(f.e2.id)).profiles).toBe(0);
  });
});
