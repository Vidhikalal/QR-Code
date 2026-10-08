import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { createHopApi } from '@/lib/staff/hop';
import { adminClient, obj } from '../fixtures/admin-api';
import { serviceClient } from '../fixtures/mail';
import { PROFILE_CHECK_CASES, PROFILE_COLUMNS } from '../fixtures/profile-cases';
import { ME_ORIGIN, participantClient } from '../fixtures/participant-api';
import { asBearer, bearerAuth, signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN §6.3, §8.3, F15 (V3): profiles, the public shape, photo via session, staff hide, organizer hop.
let f: StandardFixture;
let orgJwt: string;
let volJwt: string;
const me = participantClient();
const admin = adminClient();
const hop = (extraRoles = false) => createHopApi({ db: serviceClient(), authenticate: bearerAuth, meOrigin: ME_ORIGIN, extraRoles });

beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 6 });
  [orgJwt, volJwt] = await Promise.all([signInAs(f.staffEmail.org1), signInAs(f.staffEmail.vol1)]);
});
afterAll(async () => {
  await f.close();
});

/** A signed-in participant (cookie) with a fresh edit key. */
async function signedIn(participantId: string): Promise<string> {
  const key = generateSecret();
  await f.pool.query('select issue_profile_key($1, $2)', [participantId, sha256hex(key)]);
  return me.signIn(key);
}

async function callHop(jwt: string | null, slug: string, extraRoles = false) {
  const res = await hop(extraRoles).hop(
    new Request('http://localhost/api/staff/hop', { method: 'POST', headers: { 'content-type': 'application/json', ...asBearer(jwt) }, body: JSON.stringify({ slug }) }),
  );
  return { status: res.status, body: (await res.json()) as { url?: string; error?: string } };
}

describe('profiles table checks (PLAN §6.3)', () => {
  it('T-PROF-03: the shared case table is enforced by the database exactly as listed', async () => {
    const person = await f.addParticipant(f.e1.id);
    await f.pool.query('insert into profiles (participant_id) values ($1) on conflict do nothing', [person.id]);
    for (const c of PROFILE_CHECK_CASES) {
      const cols = Object.keys(c.patch).map((k) => PROFILE_COLUMNS[k]);
      const sets = cols.map((col, i) => `${col} = $${i + 2}`).join(', ');
      const accepted = await f.pool
        .query(`update profiles set ${sets} where participant_id = $1`, [person.id, ...Object.values(c.patch)])
        .then(() => true)
        .catch((e: { code?: string }) => {
          if (e.code !== '23514') throw e;
          return false;
        });
      expect(accepted, c.name).toBe(c.dbAccepts);
    }
  });
});

describe('/api/me/profile (PLAN §9.2)', () => {
  it('T-PROF-05: no session → 401; a session edits only its own profile; unknown keys are 400', async () => {
    const [a, b] = [await f.addParticipant(f.e1.id), await f.addParticipant(f.e1.id)];
    const cookie = await signedIn(a.id);
    const otherCookie = await signedIn(b.id);
    await me.call('updateProfile', { method: 'PATCH', cookie: otherCookie, body: { nickname: 'Bee' } });
    expect((await me.call('updateProfile', { method: 'PATCH', body: { nickname: 'X' } })).status).toBe(401);
    expect((await me.call('getProfile', { method: 'GET' })).status).toBe(401);
    const r = await me.call('updateProfile', { method: 'PATCH', cookie, body: { nickname: '  Ada  ', bio: 'Engines.', githubUrl: 'https://github.com/ada' } });
    expect(r.status).toBe(200);
    const { rows } = await f.pool.query('select participant_id, nickname, bio from profiles where participant_id = any($1) order by nickname', [[a.id, b.id]]);
    expect(rows).toEqual([
      { participant_id: a.id, nickname: 'Ada', bio: 'Engines.' },
      { participant_id: b.id, nickname: 'Bee', bio: null },
    ]);
    for (const bad of [{ participantId: b.id, nickname: 'Hijack' }, { githubUrl: 'http://github.com/ada' }, { askMeAbout: ['Rust'] }]) {
      expect((await me.call('updateProfile', { method: 'PATCH', cookie, body: bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await me.call('updateProfile', { method: 'PATCH', cookie, body: { nickname: 'X' }, origin: 'https://evil.example' })).status).toBe(403);
  });

  it('T-PROF-08 (API): GET returns the editable fields and a public preview that is name-only when hidden', async () => {
    const person = await f.addParticipant(f.e1.id);
    const cookie = await signedIn(person.id);
    await me.call('updateProfile', { method: 'PATCH', cookie, body: { nickname: 'Countess', bio: 'Engines.', visibility: 'hidden' } });
    const r = await me.call('getProfile', { method: 'GET', cookie });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ profile: { nickname: 'Countess', bio: 'Engines.', visibility: 'hidden' }, badgeRole: 'participant', canEditTopics: false });
    expect(obj(r.body).public).toEqual({ hidden: true, displayName: 'Countess', badgeRole: 'participant', label: null, eventName: f.e1.name });
    expect(obj(r.body).photo).toEqual({ url: null, locked: false });
  });
});

describe('/api/me/photo (PLAN §9.2, SPEC F5 pipeline)', () => {
  const jpeg = () => sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 0, b: 0 } } }).jpeg().toBuffer();

  it('T-PROF-06: upload works before check-in and is 409 PHOTO_LOCKED after; Origin is checked', async () => {
    const person = await f.addParticipant(f.e1.id);
    const cookie = await signedIn(person.id);
    const ok = await me.uploadPhoto(cookie, await jpeg());
    expect(ok.status).toBe(200);
    const { rows } = await f.pool.query<{ photo_path: string | null }>('select photo_path from participants where id = $1', [person.id]);
    expect(rows[0]?.photo_path).toBe(`${f.e1.id}/${person.id}.jpg`);
    expect((await me.uploadPhoto(cookie, await jpeg(), { origin: 'https://evil.example' })).status).toBe(403);
    await f.checkIn(person.id);
    expect(await me.uploadPhoto(cookie, await jpeg())).toEqual({ status: 409, body: { error: 'PHOTO_LOCKED' } });
    expect((await me.call('getProfile', { method: 'GET', cookie })).body).toMatchObject({ photo: { locked: true } });
  });
});

describe('staff hide (PLAN §6.3 abuse switch)', () => {
  it('T-PROF-09 (API): an organizer hides and unhides a profile; the audit row holds {hidden} only', async () => {
    const person = await f.addParticipant(f.e1.id);
    const cookie = await signedIn(person.id);
    await me.call('updateProfile', { method: 'PATCH', cookie, body: { nickname: 'Visible', visibility: 'public' } });
    const hide = (hidden: boolean) => admin.call('hideProfile', orgJwt, { slug: f.slug, id: person.id }, { body: { hidden } });
    expect((await hide(true)).body).toEqual({ code: 'HIDDEN' });
    expect(obj((await me.call('getProfile', { method: 'GET', cookie })).body).public).toMatchObject({ hidden: true });
    const detail = await admin.call('getParticipant', orgJwt, { slug: f.slug, id: person.id });
    expect(obj(detail.body).profile).toMatchObject({ hiddenByStaff: true, hiddenByOwner: false, public: { hidden: true, displayName: 'Visible' } });
    expect((await hide(false)).body).toEqual({ code: 'SHOWN' });
    expect(obj((await me.call('getProfile', { method: 'GET', cookie })).body).public).toMatchObject({ hidden: false, displayName: 'Visible' });
    const { rows } = await f.pool.query(`select detail from audit_log where subject_id = $1 and action = 'profile.hide' order by id`, [person.id]);
    expect(rows).toEqual([{ detail: { hidden: true } }, { detail: { hidden: false } }]);
    expect((await admin.call('hideProfile', volJwt, { slug: f.slug, id: person.id }, { body: { hidden: true } })).status).toBe(403);
    expect((await admin.call('hideProfile', orgJwt, { slug: f.slug, id: f.p.X }, { body: { hidden: true } })).status).toBe(404); // other event
  });
});

describe('organizer badge profile (PLAN F15)', () => {
  it('T-SESS-09: an organizer_hop code issued by someone else is FORBIDDEN; by the owner, ISSUED', async () => {
    const { rows } = await f.pool.query<{ r: { participantId: string } }>('select ensure_staff_attendee($1, $2, $3) as r', [f.e1.id, f.staff.org1, 'org one']);
    const row = rows[0]?.r.participantId;
    const issue = async (by: string) =>
      (await f.pool.query<{ r: string }>(`select issue_signin_code($1, $2, 'organizer_hop', $3) as r`, [row, sha256hex(generateSecret()), by])).rows[0]?.r;
    expect(await issue(f.staff.vol1)).toBe('FORBIDDEN');
    expect(await issue(f.staff.org1)).toBe('ISSUED');
  });

  it('F15: My badge profile creates one badge row (accent-folded search text) and signs the organizer in on ME', async () => {
    const zoe = await f.addUser('zoe');
    await f.pool.query(`update staff_profiles set display_name = 'Zoë Ödegaard' where user_id = $1`, [zoe.id]);
    await f.pool.query(`insert into event_staff (event_id, user_id, role) values ($1, $2, 'organizer')`, [f.e1.id, zoe.id]);
    const jwt = await signInAs(zoe.email);
    const first = await callHop(jwt, f.slug);
    expect(first.status).toBe(200);
    expect(first.body.url).toMatch(new RegExp(`^${ME_ORIGIN}/signin#[A-Za-z0-9_-]{43}$`));
    expect((await callHop(jwt, f.slug)).status).toBe(200);
    const { rows } = await f.pool.query('select badge_role, source, status, search_text from participants where staff_user_id = $1', [zoe.id]);
    expect(rows).toEqual([{ badge_role: 'organizer', source: 'staff', status: 'accepted', search_text: 'zoe odegaard' }]);
    const opened = await me.call('redeemCode', { body: { code: first.body.url?.split('#')[1] } });
    expect(opened.body).toEqual({ code: 'OPENED', next: '/me' });
    const cookie = opened.setCookie?.split(';')[0] ?? '';
    const profile = await me.call('getProfile', { method: 'GET', cookie });
    expect(profile.body).toMatchObject({ badgeRole: 'organizer', canEditTopics: true, public: { label: 'Organizer', displayName: 'Zoë Ödegaard' } });
    expect((await me.call('updateProfile', { method: 'PATCH', cookie, body: { askMeAbout: ['Rust', 'Sponsors'] } })).status).toBe(200);
  });

  it('F15: volunteers get 403 unless FEATURE_EXTRA_BADGE_ROLES; other events and signed-out callers are refused', async () => {
    expect((await callHop(volJwt, f.slug)).status).toBe(403);
    expect((await callHop(volJwt, f.slug, true)).status).toBe(200);
    expect((await callHop(orgJwt, `${f.slug}-2`)).status).toBe(403);
    expect((await callHop(null, f.slug)).status).toBe(401);
  });

  it('V3 metrics: an organizer badge row is not an accepted attendee or a no-show', async () => {
    const fresh = await f.addUser('metrics');
    await f.pool.query(`insert into event_staff (event_id, user_id, role) values ($1, $2, 'organizer')`, [f.e1.id, fresh.id]);
    const before = obj((await admin.call('dashboard', orgJwt, { slug: f.slug })).body);
    const made = await f.pool.query<{ r: { code: string } }>('select ensure_staff_attendee($1, $2, $3) as r', [f.e1.id, fresh.id, 'metrics one']);
    expect(made.rows[0]?.r.code).toBe('OK');
    const after = obj((await admin.call('dashboard', orgJwt, { slug: f.slug })).body);
    expect([after.accepted, after.noShows]).toEqual([before.accepted, before.noShows]);
  });
});
