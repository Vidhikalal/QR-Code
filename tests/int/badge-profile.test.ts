import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateToken } from '@/lib/domain/token';
import { passClient } from '../fixtures/pass';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §6.5 badge profile (opt-in) and PATCH /api/pass (§9.3).
let f: StandardFixture;
beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

const profileOf = async (uid: string) =>
  (await f.pool.query<{ p: unknown }>('select badge_profile($1) as p', [uid])).rows[0]?.p ?? null;
const setPublic = (participantId: string, linkedin: string | null) =>
  f.pool.query('update participants set profile_public = true, linkedin_url = $2 where id = $1', [participantId, linkedin]);

describe('badge_profile() (SPEC §6.5)', () => {
  it('T-NFC-12: unlinked → null; not shared → only {public:false}; shared → name + LinkedIn and nothing else', async () => {
    expect(await profileOf(randomUid())).toBeNull();
    const { uid } = await f.linkBadge(f.p.A);
    expect(await profileOf(uid)).toEqual({ public: false });

    await setPublic(f.p.A, 'https://www.linkedin.com/in/ada-fixture');
    // toEqual: exactly these keys; never email, dietary notes ("Vegetarian"), status or photo.
    expect(await profileOf(uid)).toEqual({
      public: true,
      firstName: 'Ada',
      lastName: 'Fixture',
      linkedinUrl: 'https://www.linkedin.com/in/ada-fixture',
    });
  });

  it('T-NFC-12: a tombstoned participant’s badge shows nothing', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const { uid } = await f.linkBadge(id);
    await setPublic(id, null);
    expect(await profileOf(uid)).toMatchObject({ public: true });
    await f.pool.query('select delete_participant($1, $2, $3)', [f.e1.id, id, f.staff.org1]);
    expect(await profileOf(uid)).toBeNull();
  });

  it('T-NFC-12: a badge reused at a later event shows the newest link', async () => {
    const uid = randomUid();
    await f.linkBadge(f.p.X, { uid, actor: f.staff.vol3 });
    await setPublic(f.p.X, null);
    expect(await profileOf(uid)).toMatchObject({ public: true, firstName: 'Xan' });
    await f.linkBadge(f.p.N, { uid });
    expect(await profileOf(uid)).toEqual({ public: false });
  });
});

describe('badge_profile() visibility limits (SPEC §6.5)', () => {
  it('T-NFC-12: a participant who is no longer accepted shows nothing, even if they had opted in', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const { uid } = await f.linkBadge(id);
    await setPublic(id, 'https://www.linkedin.com/in/someone');
    expect(await profileOf(uid)).toMatchObject({ public: true });
    await f.pool.query(`update participants set status = 'withdrawn' where id = $1`, [id]);
    expect(await profileOf(uid)).toBeNull();
  });

  it('T-NFC-12: links from an event that ended more than 30 days ago show nothing', async () => {
    const { rows } = await f.pool.query<{ id: string }>(
      `insert into events (slug, name, venue, starts_at, ends_at)
       values ($1, 'Old Event', 'Old Hall', now() - interval '40 days', now() - interval '31 days') returning id`,
      [`${f.slug}-old`],
    );
    const oldEvent = rows[0]?.id ?? '';
    const { id } = await f.addParticipant(oldEvent);
    const { uid } = await f.linkBadge(id);
    await setPublic(id, null);
    expect(await profileOf(uid)).toBeNull();
    await f.pool.query(`update events set ends_at = now() - interval '29 days' where id = $1`, [oldEvent]);
    expect(await profileOf(uid)).toMatchObject({ public: true });
  });
});

describe('PATCH /api/pass (SPEC §9.3)', () => {
  it('T-NFC-13: an active token sets the opt-in, audits it without PII, and the pass page reflects it', async () => {
    const c = passClient();
    const res = await c.patch({ token: f.token.B, profilePublic: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ profile: { public: true, hasLinkedin: false } });
    const row = await f.pool.query('select profile_public from participants where id = $1', [f.p.B]);
    expect(row.rows).toEqual([{ profile_public: true }]);
    const audit = await f.pool.query(
      `select actor_kind, actor_user_id, detail from audit_log where action = 'profile.visibility' and subject_id = $1`,
      [f.p.B],
    );
    expect(audit.rows).toEqual([{ actor_kind: 'participant', actor_user_id: null, detail: { public: true } }]);
    expect(await (await c.lookup({ token: f.token.B })).json()).toMatchObject({ profile: { public: true, hasLinkedin: false } });

    expect(await (await c.patch({ token: f.token.B, profilePublic: false })).json()).toEqual({ profile: { public: false, hasLinkedin: false } });
  });

  it('T-NFC-13: replaced, cancelled and unknown tokens → 404 and nothing changes; a bad body → 400', async () => {
    const c = passClient();
    for (const token of [f.rvOldToken, f.token.Wd, generateToken()]) {
      const res = await c.patch({ token, profilePublic: true });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ state: 'not_found' });
    }
    const rows = await f.pool.query('select profile_public from participants where id = any($1)', [[f.p.Rv, f.p.Wd]]);
    expect(rows.rows).toEqual([{ profile_public: false }, { profile_public: false }]);
    expect((await c.patch({ token: f.token.N, profilePublic: true, extra: 1 })).status).toBe(400);
    expect((await c.patch({ token: f.token.N, profilePublic: 'yes' })).status).toBe(400);
    expect((await c.patch({ token: f.token.N })).status).toBe(400);
  });
});
