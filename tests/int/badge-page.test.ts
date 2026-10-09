import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadBadgePage } from '@/lib/badge/handlers';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { serviceClient } from '../fixtures/mail';
import { ME_ORIGIN, participantClient } from '../fixtures/participant-api';
import { asBearer, bearerAuth, signInAs } from '../fixtures/staff';
import { createStandardFixture, type Badges, type StandardFixture } from '../fixtures/standard';

// PLAN §8 (V4b): loading /t/<publicId> for each kind of viewer, against real Postgres.
let f: StandardFixture;
let b: Badges;
let vol1: string;
let vol3: string;
const me = participantClient();
const db = serviceClient();

beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 4 });
  b = await f.addBadges();
  [vol1, vol3] = await Promise.all([signInAs(f.staffEmail.vol1), signInAs(f.staffEmail.vol3)]);
});
afterAll(async () => {
  await f.close();
});

async function participantCookie(participantId: string): Promise<string> {
  const key = generateSecret();
  await f.pool.query('select issue_profile_key($1, $2)', [participantId, sha256hex(key)]);
  return me.signIn(key);
}

const load = (publicId: string, o: { jwt?: string; cookie?: string; now?: Date } = {}) =>
  loadBadgePage({
    db,
    publicId,
    request: new Request(`${ME_ORIGIN}/t/${publicId}`, { headers: { ...asBearer(o.jwt ?? null), ...(o.cookie && { cookie: o.cookie }) } }),
    authenticate: bearerAuth,
    meOrigin: ME_ORIGIN,
    extraRoles: false,
    now: o.now ?? new Date(),
  });

function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysDeep(x, out);
    }
  }
  return out;
}

describe('badge page loader (PLAN §8.1)', () => {
  it('T-BADGE-02 (I): anonymous, participant and owner views carry no private keys', async () => {
    await f.pool.query(`update participants set photo_path = 'x/y.jpg', dietary_notes = 'Vegan' where id = $1`, [f.p.A]);
    const views = [await load(b.tag.T1.publicId), await load(b.tag.T1.publicId, { cookie: await participantCookie(f.p.B) }), await load(b.tag.T1.publicId, { cookie: await participantCookie(f.p.A) })];
    expect(views.map((v) => (v.kind === 'linked' ? v.audience : v.kind))).toEqual(['anonymous', 'participant', 'owner']);
    for (const v of views) expect(keysDeep(v).filter((k) => /email|photo|dietary|^status$|scans|^staff$/i.test(k))).toEqual([]);
    expect(JSON.stringify(views)).not.toMatch(/Vegan|@|x\/y\.jpg/);
    // The fake path has no storage object; restore it so staff views (which sign photos) work.
    await f.pool.query('update participants set photo_path = null, dietary_notes = null where id = $1', [f.p.A]);
  });

  it('T-BADGE-03: an E2 volunteer opening an E1 badge is treated as non-staff', async () => {
    const v = await load(b.tag.T1.publicId, { jwt: vol3 });
    expect(v).toMatchObject({ kind: 'linked', audience: 'anonymous' });
    expect(v).not.toHaveProperty('staff');
    const own = await load(b.tag.T1.publicId, { jwt: vol1 });
    expect(own).toMatchObject({ audience: 'staff', staff: { holder: { fullName: 'Ada Fixture', status: 'accepted' } } });
  });

  it('T-BADGE-04: an unlinked badge suggests the person this staff member admitted in the last 2 minutes', async () => {
    const n = await f.addParticipant(f.e1.id);
    const scan = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, participantId: n.id });
    expect(scan.code).toBe('ACCEPTED');
    await f.pool.query(`update scans set scanned_at = now() - interval '14 seconds' where id = $1`, [scan.scanId]);
    const v = await load(b.tag.T5.publicId, { jwt: vol1 });
    expect(v).toMatchObject({ kind: 'unlinked', staff: { suggestion: { participantId: n.id, name: 'Extra Fixture' } } });
    if (v.kind === 'unlinked') expect(v.staff?.suggestion?.secondsAgo).toBeGreaterThanOrEqual(13);
    // Another staff member's admission is not suggested to vol1's colleague.
    const vol2 = await signInAs(f.staffEmail.vol2);
    expect(await load(b.tag.T5.publicId, { jwt: vol2 })).toMatchObject({ staff: { suggestion: null } });
    // Too old → none.
    await f.pool.query(`update scans set scanned_at = now() - interval '121 seconds' where id = $1`, [scan.scanId]);
    expect(await load(b.tag.T5.publicId, { jwt: vol1 })).toMatchObject({ staff: { suggestion: null } });
    // Linked already → none.
    await f.pool.query(`update scans set scanned_at = now() - interval '5 seconds' where id = $1`, [scan.scanId]);
    await f.pool.query('select assign_tag($1, $2, $3, $4, null, false)', [f.e1.id, f.staff.vol1, n.id, b.tag.T6.publicId]);
    expect(await load(b.tag.T5.publicId, { jwt: vol1 })).toMatchObject({ staff: { suggestion: null } });
  });

  it('T-BADGE-06 (I): after ends_at + retention days, every viewer sees "used at"', async () => {
    const later = new Date(Date.now() + 40 * 86_400_000);
    expect(await load(b.tag.T1.publicId, { now: later })).toEqual({ kind: 'used', eventName: f.e1.name });
    expect(await load(b.tag.T1.publicId, { jwt: vol1, now: later })).toMatchObject({ kind: 'used', profileDeletedOn: expect.any(String) });
  });

  it('PLAN §8.2: unknown badge → not_found; a retired badge tells its old owner the new label', async () => {
    expect(await load('AAAAAAAAAAAA')).toEqual({ kind: 'not_found' });
    const n = await f.addParticipant(f.e1.id);
    await f.pool.query('select assign_tag($1, $2, $3, $4, null, false)', [f.e1.id, f.staff.org1, n.id, b.tag.T7.publicId]);
    await f.pool.query('select assign_tag($1, $2, $3, $4, null, true)', [f.e1.id, f.staff.org1, n.id, b.tag.T8.publicId]);
    expect(await load(b.tag.T7.publicId, { cookie: await participantCookie(n.id) })).toEqual({ kind: 'retired', eventName: f.e1.name, replacementLabel: 'T8' });
    expect(await load(b.tag.T7.publicId, { jwt: vol1 })).toMatchObject({ kind: 'retired', staff: { current: { label: 'T8', holderName: 'Extra Fixture' } } });
  });

  it('T-BADGE-09: 50 loads each as anonymous, participant and staff change no event state', async () => {
    const tables = (await f.pool.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' and tablename <> 'rate_limits' order by 1`)).rows.map((r) => r.tablename);
    const snapshot = async () => {
      const out: Record<string, number> = {};
      for (const t of tables) out[t] = (await f.pool.query<{ n: number }>(`select count(*)::int as n from public.${JSON.stringify(t)}`)).rows[0]?.n ?? 0;
      // Contents that a page view could plausibly touch, beyond row counts.
      out.assignmentsEnded = (await f.pool.query<{ n: number }>('select count(*)::int as n from tag_assignments where ended_at is not null')).rows[0]?.n ?? 0;
      out.sessionsRevoked = (await f.pool.query<{ n: number }>('select count(*)::int as n from participant_sessions where revoked_at is not null')).rows[0]?.n ?? 0;
      return out;
    };
    const cookie = await participantCookie(f.p.B);
    const before = await snapshot();
    for (let i = 0; i < 50; i++) {
      await load(b.tag.T1.publicId);
      await load(b.tag.T1.publicId, { cookie });
      await load(b.tag.T4.publicId, { jwt: vol1 });
    }
    expect(await snapshot()).toEqual(before);
  });

  it('V5b: staff views carry the station, open checkpoints and the holder’s involvement; others don’t', async () => {
    await f.pool.query('select set_staff_station($1, $2)', [f.staff.vol1, f.cp.G]);
    await f.tapBadge(f.staff.vol1, f.cp.G, b.tag.T2);
    const v = await load(b.tag.T2.publicId, { jwt: vol1 });
    expect(v).toMatchObject({
      kind: 'linked',
      staff: {
        station: { checkpointId: f.cp.G, name: 'Games', kind: 'custom' },
        involvement: { points: 5, activities: [{ name: 'Games', points: 5 }] },
        publicId: b.tag.T2.publicId,
      },
    });
    if (v.kind === 'linked') expect(v.staff?.checkpoints.map((c) => c.name)).toContain('Lunch');
    const anon = await load(b.tag.T2.publicId);
    expect(JSON.stringify(anon)).not.toMatch(/involvement|station|Games/);
  });
});
