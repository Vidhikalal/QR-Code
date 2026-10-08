import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventsApi } from '@/lib/events/handlers';
import { adminClient, obj } from '../fixtures/admin-api';
import { serviceClient } from '../fixtures/mail';
import { asBearer, bearerAuth, signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN §6.2 / F13 / F14: platform admins, create_event, join_event_as_admin, list_events_for, settings.
let f: StandardFixture;
let admin: { id: string; email: string };
let adminJwt: string;
let orgJwt: string;
const admins = adminClient();
const events = createEventsApi({ db: serviceClient(), authenticate: bearerAuth });

const T0 = '2026-10-03T13:00:00Z';
const T1 = '2026-10-03T22:00:00Z';
const freshSlug = () => `e-${randomBytes(5).toString('hex')}`;

async function createEventSql(adminId: string, over: { slug?: string; tz?: string; starts?: string; ends?: string } = {}) {
  const { rows } = await f.pool.query<{ r: { code: string; eventId?: string } }>(
    'select create_event($1, $2, $3, $4, $5, $6, $7) as r',
    [adminId, over.slug ?? freshSlug(), 'Created Event', 'Hall', over.starts ?? T0, over.ends ?? T1, over.tz ?? 'America/Toronto'],
  );
  const r = rows[0]?.r;
  if (!r) throw new Error('create_event returned nothing');
  return r;
}

async function callEvents(name: keyof typeof events, jwt: string | null, params: Record<string, string>, body?: unknown) {
  const request = new Request('http://localhost/api/admin/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...asBearer(jwt) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const res = await events[name](request, params);
  return { status: res.status, body: obj(await res.json()) };
}

beforeAll(async () => {
  f = await createStandardFixture();
  admin = await f.addPlatformAdmin();
  [adminJwt, orgJwt] = await Promise.all([signInAs(admin.email), signInAs(f.staffEmail.org1)]);
});
afterAll(async () => {
  await f.close();
});

describe('create_event (PLAN §6.2)', () => {
  it('T-EVT-01: a non-admin (even an organizer) gets FORBIDDEN', async () => {
    expect((await createEventSql(f.staff.org1)).code).toBe('FORBIDDEN');
  });

  it('T-EVT-02: an unknown IANA zone gives INVALID_TIMEZONE', async () => {
    expect((await createEventSql(admin.id, { tz: 'Mars/Olympus' })).code).toBe('INVALID_TIMEZONE');
  });

  it('T-EVT-03: ends_at <= starts_at gives INVALID_DATES', async () => {
    expect((await createEventSql(admin.id, { ends: T0 })).code).toBe('INVALID_DATES');
    expect((await createEventSql(admin.id, { ends: '2026-10-03T12:00:00Z' })).code).toBe('INVALID_DATES');
  });

  it('T-EVT-04: creates the event, exactly one closed Door, and the creator as organizer', async () => {
    const slug = freshSlug();
    const r = await createEventSql(admin.id, { slug });
    expect(r.code).toBe('CREATED');
    const { rows: cps } = await f.pool.query('select name, kind, is_open, requires_checkin from checkpoints where event_id = $1', [r.eventId]);
    expect(cps).toEqual([{ name: 'Door', kind: 'door', is_open: false, requires_checkin: false }]);
    const { rows: staff } = await f.pool.query('select user_id, role from event_staff where event_id = $1', [r.eventId]);
    expect(staff).toEqual([{ user_id: admin.id, role: 'organizer' }]);
    const { rows: ev } = await f.pool.query('select slug, created_by from events where id = $1', [r.eventId]);
    expect(ev).toEqual([{ slug, created_by: admin.id }]);
    const { rows: audit } = await f.pool.query(`select detail from audit_log where event_id = $1 and action = 'event.create'`, [r.eventId]);
    expect(audit).toEqual([{ detail: {} }]);
  });

  it('T-EVT-05: the same slug again gives SLUG_TAKEN', async () => {
    const slug = freshSlug();
    expect((await createEventSql(admin.id, { slug })).code).toBe('CREATED');
    expect((await createEventSql(admin.id, { slug })).code).toBe('SLUG_TAKEN');
  });

  it('T-EVT-05: reserved slugs are rejected by the database', async () => {
    await expect(createEventSql(admin.id, { slug: 'new' })).rejects.toThrow(/events_slug_not_reserved/);
    await expect(createEventSql(admin.id, { slug: 'events' })).rejects.toThrow(/events_slug_not_reserved/);
  });
});

describe('platform admins and the events list', () => {
  it('T-EVT-06: consume_platform_admin links user_id from the verified, normalized email', async () => {
    const u = await f.addUser('pending');
    const email = `admin-${randomBytes(4).toString('hex')}@club.ca`;
    await f.pool.query('insert into platform_admins (email) values ($1)', [email]);
    const messy = ` ${email.replace('admin', 'Admin').replace('club.ca', 'Club.CA')} `;
    const { rows } = await f.pool.query<{ ok: boolean }>('select consume_platform_admin($1, $2) as ok', [u.id, messy]);
    expect(rows[0]?.ok).toBe(true);
    const { rows: linked } = await f.pool.query('select user_id from platform_admins where email = $1', [email]);
    expect(linked).toEqual([{ user_id: u.id }]);
    const { rows: isAdmin } = await f.pool.query<{ a: boolean }>('select is_platform_admin($1) as a', [u.id]);
    expect(isAdmin[0]?.a).toBe(true);
  });

  it('T-EVT-07: an admin sees every event (role null where not staff); a user with no events sees none', async () => {
    const { rows } = await f.pool.query<{ id: string; my_role: string | null }>('select id, my_role from list_events_for($1)', [admin.id]);
    const byId = new Map(rows.map((r) => [r.id, r.my_role]));
    expect(byId.has(f.e1.id) && byId.has(f.e2.id)).toBe(true);
    expect(byId.get(f.e1.id)).toBeNull();
    const nobody = await f.addUser('nobody');
    expect((await f.pool.query('select * from list_events_for($1)', [nobody.id])).rows).toEqual([]);
    const { rows: vol } = await f.pool.query('select id, my_role from list_events_for($1)', [f.staff.vol3]);
    expect(vol).toEqual([{ id: f.e2.id, my_role: 'volunteer' }]);
  });

  it('T-EVT-08: join as organizer: admin JOINED (volunteer row upgraded); non-admin 403; unknown event 404', async () => {
    const promoted = await f.addPlatformAdmin();
    await f.pool.query(`insert into event_staff (event_id, user_id, role) values ($1, $2, 'volunteer')`, [f.e2.id, promoted.id]);
    const jwt = await signInAs(promoted.email);
    const ok = await callEvents('joinEvent', jwt, { id: f.e2.id });
    expect(ok).toEqual({ status: 200, body: { code: 'JOINED' } });
    const { rows } = await f.pool.query('select role from event_staff where event_id = $1 and user_id = $2', [f.e2.id, promoted.id]);
    expect(rows).toEqual([{ role: 'organizer' }]);
    expect((await callEvents('joinEvent', orgJwt, { id: f.e2.id })).status).toBe(403);
    expect((await callEvents('joinEvent', jwt, { id: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await callEvents('joinEvent', null, { id: f.e2.id })).status).toBe(401);
  });
});

describe('POST /api/admin/events (F14)', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    slug: freshSlug(),
    name: 'Hack Day',
    venue: 'Bahen Centre',
    startsAt: '2026-10-03T09:00',
    endsAt: '2026-10-03T18:00',
    timezone: 'America/Toronto',
    ...over,
  });

  it('T-EVT-10: a non-admin gets 403 (before any validation); signed out gets 401', async () => {
    expect((await callEvents('createEvent', orgJwt, {}, body())).status).toBe(403);
    expect((await callEvents('createEvent', orgJwt, {}, {})).status).toBe(403);
    expect((await callEvents('createEvent', null, {}, body())).status).toBe(401);
  });

  it('T-EVT-10: an admin creates an event from wall-clock times in the event time zone', async () => {
    const b = body();
    const r = await callEvents('createEvent', adminJwt, {}, b);
    expect(r).toMatchObject({ status: 200, body: { code: 'CREATED', slug: b.slug } });
    const { rows } = await f.pool.query<{ starts_at: Date; ends_at: Date; timezone: string }>(
      'select starts_at, ends_at, timezone from events where slug = $1',
      [b.slug],
    );
    expect(rows[0]?.starts_at.toISOString()).toBe('2026-10-03T13:00:00.000Z'); // 09:00 EDT
    expect(rows[0]?.ends_at.toISOString()).toBe('2026-10-03T22:00:00.000Z');
  });

  it('T-EVT-10: domain outcomes come back as codes; bad bodies are 400', async () => {
    expect((await callEvents('createEvent', adminJwt, {}, body({ timezone: 'Mars/Olympus' }))).body).toEqual({ code: 'INVALID_TIMEZONE' });
    expect((await callEvents('createEvent', adminJwt, {}, body({ endsAt: '2026-10-03T09:00' }))).body).toEqual({ code: 'INVALID_DATES' });
    const taken = body();
    await callEvents('createEvent', adminJwt, {}, taken);
    expect((await callEvents('createEvent', adminJwt, {}, taken)).body).toEqual({ code: 'SLUG_TAKEN' });
    for (const bad of [{ slug: 'new' }, { slug: 'events' }, { slug: 'Has Caps' }, { name: '' }, { startsAt: '2026-10-03T09:00:00Z' }, { extra: 1 }]) {
      expect((await callEvents('createEvent', adminJwt, {}, body(bad))).status, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe('PATCH /api/admin/[slug]/settings (F14.3)', () => {
  it('T-EVT-09: out-of-range values are 400; valid values persist; the audit row holds key names only', async () => {
    const patch = (b: unknown) => admins.call('updateSettings', orgJwt, { slug: f.slug }, { method: 'PATCH', body: b });
    for (const bad of [
      { leaderboardRefreshMinutes: 45 },
      { organizerConnectionBonus: 101 },
      { badgeUnlockPassword: 'abc' },
      { profileRetentionDays: 0 },
      {},
      { recapMessage: 'later' },
    ]) {
      expect((await patch(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const ok = await patch({ leaderboardRefreshMinutes: 15, organizerConnectionBonus: 5, organizersCompete: true, badgeUnlockPassword: 'tap-2026' });
    expect(ok.status).toBe(200);
    const got = await admins.call('getSettings', orgJwt, { slug: f.slug });
    expect(got.body).toEqual({
      leaderboardRefreshMinutes: 15,
      organizerConnectionBonus: 5,
      organizersCompete: true,
      badgeUnlockPassword: 'tap-2026',
      profileRetentionDays: 30,
    });
    const { rows } = await f.pool.query<{ detail: unknown }>(
      `select detail from audit_log where event_id = $1 and action = 'event.settings'`,
      [f.e1.id],
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.detail)).not.toContain('tap-2026');
    expect(rows[0]?.detail).toEqual({ changed: ['badgeUnlockPassword', 'leaderboardRefreshMinutes', 'organizerConnectionBonus', 'organizersCompete'] });
  });
});
