import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { drainUntilIdle } from '@/lib/email/drain';
import { ingestClient, sheetRow } from '../fixtures/ingest';
import { editKeyFromEmail, mockProvider, sentTo, serviceClient, tokenFromEmail } from '../fixtures/mail';
import { participantClient } from '../fixtures/participant-api';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN §6.4 / F16–F18 (V2a): edit keys in pass emails, participant sessions, rotation, outbox kinds.
let f: StandardFixture;
const db = serviceClient();
const mail = mockProvider();
const drain = () => drainUntilIdle({ db, provider: mail.provider, appOrigin: 'http://localhost:3100', from: 'Passline <p@localhost>' });
const me = participantClient();

beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 6 });
});
afterAll(async () => {
  await f.close();
});

async function emailOf(id: string): Promise<string> {
  const { rows } = await f.pool.query<{ email: string }>('select email from participants where id = $1', [id]);
  return rows[0]?.email ?? '';
}

async function enqueue(participantId: string, kind = 'pass_issued') {
  await f.pool.query('insert into email_outbox (participant_id, kind) values ($1, $2)', [participantId, kind]);
}

/** An accepted person who has received one pass email; returns their id, address and edit key. */
async function acceptedWithEmail() {
  const person = await f.addParticipant(f.e1.id, { withPass: false });
  await enqueue(person.id);
  await drain();
  const address = await emailOf(person.id);
  const [m] = sentTo(mail.sent, address);
  if (!m) throw new Error('no pass email');
  return { id: person.id, address, key: editKeyFromEmail(m), message: m };
}

const liveSessions = async (participantId: string) =>
  (
    await f.pool.query<{ n: number }>(
      'select count(*)::int as n from participant_sessions where participant_id = $1 and revoked_at is null and expires_at > now()',
      [participantId],
    )
  ).rows[0]?.n ?? 0;

const sessionParticipant = async (cookie: string) =>
  (await f.pool.query<{ p: string | null }>('select session_participant($1) as p', [sha256hex(cookie.split('=')[1] ?? '')])).rows[0]?.p ?? null;

describe('edit keys (PLAN §6.4, D9)', () => {
  it('T-PROF-01: two pass emails carry two different keys and both open a session', async () => {
    const p = await acceptedWithEmail();
    await enqueue(p.id, 'pass_reissued');
    await drain();
    const keys = sentTo(mail.sent, p.address).map(editKeyFromEmail);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    for (const key of keys) expect((await me.call('openSession', { body: { key } })).body).toEqual({ code: 'OPENED', next: '/me' });
  });

  it('T-PROF-02: the first key creates the profile, starting from the form LinkedIn', async () => {
    const person = await f.addParticipant(f.e1.id, { withPass: false });
    await f.pool.query(`update participants set linkedin_url = 'https://www.linkedin.com/in/ada-l' where id = $1`, [person.id]);
    await enqueue(person.id);
    await drain();
    const { rows } = await f.pool.query('select linkedin_url, visibility from profiles where participant_id = $1', [person.id]);
    expect(rows).toEqual([{ linkedin_url: 'https://www.linkedin.com/in/ada-l', visibility: 'public' }]);
  });

  it('T-PROF-07: Get a new link revokes every key and signs out every device; the new emailed key works', async () => {
    const p = await acceptedWithEmail();
    const [a, b] = [await me.signIn(p.key), await me.signIn(p.key)];
    const r = await me.call('rotate', { cookie: a });
    expect(r.body).toEqual({ code: 'ROTATED' });
    expect(me.scheduled.length).toBeGreaterThan(0); // the new link is drained right after the response
    expect(r.setCookie).toMatch(/Max-Age=0/);
    expect(await liveSessions(p.id)).toBe(0);
    expect(await sessionParticipant(b)).toBeNull();
    expect((await me.call('openSession', { body: { key: p.key } })).body).toEqual({ code: 'KEY_REVOKED' });
    await drain();
    const mine = sentTo(mail.sent, p.address);
    const last = mine[mine.length - 1];
    if (!last) throw new Error('no profile link email');
    expect(last.subject).toContain('profile link');
    expect((await me.call('openSession', { body: { key: editKeyFromEmail(last) } })).body).toEqual({ code: 'OPENED', next: '/me' });
  });
});

describe('participant sessions (PLAN §5.2, F17, F18)', () => {
  it('T-SESS-01: an unknown key is KEY_NOT_FOUND in SQL and the generic LINK_INVALID from the API', async () => {
    const key = generateSecret();
    const { rows } = await f.pool.query<{ r: { code: string } }>(
      `select open_profile_session($1, $2, interval '1 day') as r`,
      [sha256hex(key), sha256hex(generateSecret())],
    );
    expect(rows[0]?.r).toEqual({ code: 'KEY_NOT_FOUND' });
    const api = await me.call('openSession', { body: { key } });
    expect(api).toMatchObject({ status: 200, body: { code: 'LINK_INVALID' }, setCookie: null });
    expect((await me.call('openSession', { body: { nope: 1 } })).status).toBe(400);
  });

  it('T-SESS-02: signing out device A leaves device B signed in', async () => {
    const p = await acceptedWithEmail();
    const [a, b] = [await me.signIn(p.key), await me.signIn(p.key)];
    expect((await me.call('me', { method: 'GET', cookie: a })).body).toMatchObject({ firstName: 'Extra' });
    const out = await me.call('endSession', { method: 'DELETE', cookie: a });
    expect(out.status).toBe(200);
    expect(out.setCookie).toMatch(/Max-Age=0/);
    expect((await me.call('me', { method: 'GET', cookie: a })).status).toBe(401);
    expect((await me.call('me', { method: 'GET', cookie: b })).status).toBe(200);
  });

  it('T-SESS-03: withdrawn in the Sheet → every session signed out, keys NOT_ELIGIBLE', async () => {
    const c = ingestClient();
    const row = sheetRow(f.slug);
    expect(await c.ingest(f.slug, [row])).toEqual(['PASS_QUEUED']);
    await c.drain();
    const [m] = sentTo(c.mail.sent, row.email);
    if (!m) throw new Error('no pass email');
    const key = editKeyFromEmail(m);
    const cookie = await me.signIn(key);
    expect(await c.ingest(f.slug, [{ ...row, status: 'Withdrawn' }])).toEqual(['REVOKED']);
    expect(await sessionParticipant(cookie)).toBeNull();
    expect((await me.call('me', { method: 'GET', cookie })).status).toBe(401);
    const { rows } = await f.pool.query<{ r: { code: string } }>(
      `select open_profile_session($1, $2, interval '1 day') as r`,
      [sha256hex(key), sha256hex(generateSecret())],
    );
    expect(rows[0]?.r).toEqual({ code: 'NOT_ELIGIBLE' });
    expect((await me.call('openSession', { body: { key } })).body).toEqual({ code: 'LINK_INVALID' });
  });

  it('T-SESS-04: a session past expires_at is signed out', async () => {
    const p = await acceptedWithEmail();
    const cookie = await me.signIn(p.key);
    await f.pool.query(`update participant_sessions set expires_at = now() - interval '1 second' where participant_id = $1`, [p.id]);
    expect((await me.call('me', { method: 'GET', cookie })).status).toBe(401);
  });

  it('T-SESS-05: cookie is HttpOnly, SameSite=Lax, Path=/, no Domain; __Host- and Secure on https', async () => {
    const p = await acceptedWithEmail();
    const http = (await me.call('openSession', { body: { key: p.key } })).setCookie ?? '';
    expect(http).toMatch(/^pl_me=[A-Za-z0-9_-]{43}; /);
    for (const attr of ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${30 * 86400}`]) expect(http).toContain(attr);
    expect(http).not.toMatch(/Domain=|Secure/i);
    const secure = participantClient('https://me.example.test');
    const https = (await secure.call('openSession', { body: { key: p.key } })).setCookie ?? '';
    expect(https).toMatch(/^__Host-pl_me=/);
    expect(https).toContain('Secure');
    expect(https).not.toMatch(/Domain=/i);
  });

  it('T-SESS-11: the 31st session attempt in a minute from one IP gets 429', async () => {
    const ip = `198.51.100.${Date.now()}`;
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await me.call('openSession', { body: { key: generateSecret() }, ip })).status);
    expect(codes.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(codes[30]).toBe(429);
  });

  it('T-SEC2-06: a foreign or missing Origin gets 403 on every participant mutation, with no writes', async () => {
    const p = await acceptedWithEmail();
    const cookie = await me.signIn(p.key);
    const before = await liveSessions(p.id);
    for (const origin of ['https://evil.example', null]) {
      expect((await me.call('openSession', { body: { key: p.key }, origin })).status).toBe(403);
      expect((await me.call('endSession', { method: 'DELETE', cookie, origin })).status).toBe(403);
      expect((await me.call('rotate', { cookie, origin })).status).toBe(403);
    }
    expect(await liveSessions(p.id)).toBe(before);
    expect((await me.call('openSession', { body: { key: p.key } })).status).toBe(200);
  });

  it('T-PROF-05 (partial): /api/me, sign-out and rotate need a session', async () => {
    expect((await me.call('me', { method: 'GET' })).status).toBe(401);
    expect((await me.call('me', { method: 'GET', cookie: `pl_me=${generateSecret()}` })).status).toBe(401);
    expect((await me.call('endSession', { method: 'DELETE' })).status).toBe(401);
    expect((await me.call('rotate', {})).status).toBe(401);
  });
});

describe('outbox kinds (PLAN §6.7)', () => {
  it('T-OUT-01: ingest accepted twice after the outbox migration → PASS_QUEUED, UNCHANGED', async () => {
    const c = ingestClient();
    const row = sheetRow(f.slug);
    expect(await c.ingest(f.slug, [row])).toEqual(['PASS_QUEUED']);
    expect(await c.ingest(f.slug, [row])).toEqual(['UNCHANGED']);
  });

  it('T-OUT-02 / T-OUT-03: a pending pass email blocks another pass email but not a profile link', async () => {
    const person = await f.addParticipant(f.e1.id, { withPass: false });
    await enqueue(person.id);
    const pass = await f.pool.query<{ r: string }>('select enqueue_pass($1, $2, $3) as r', [f.e1.id, person.id, f.staff.org1]);
    expect(pass.rows[0]?.r).toBe('IN_FLIGHT');
    const link1 = await f.pool.query<{ r: string }>('select request_profile_link($1) as r', [person.id]);
    const link2 = await f.pool.query<{ r: string }>('select request_profile_link($1) as r', [person.id]);
    expect([link1.rows[0]?.r, link2.rows[0]?.r]).toEqual(['QUEUED', 'IN_FLIGHT']);
    const waitlisted = await f.pool.query<{ r: string }>('select request_profile_link($1) as r', [f.p.C]);
    expect(waitlisted.rows[0]?.r).toBe('NOT_ELIGIBLE');
  });

  it('T-OUT-05: at provider-call time the pass hash and the edit-key hash are both committed and active', async () => {
    const person = await f.addParticipant(f.e1.id, { withPass: false });
    await enqueue(person.id);
    const address = await emailOf(person.id);
    const observed: unknown[] = [];
    const { provider } = mockProvider(async (m) => {
      if (m.to !== address) return;
      const pass = await f.pool.query('select revoked_at from passes where token_hash = $1', [sha256hex(tokenFromEmail(m))]);
      const key = await f.pool.query('select revoked_at from profile_keys where key_hash = $1', [sha256hex(editKeyFromEmail(m))]);
      observed.push([pass.rows, key.rows]);
    });
    await drainUntilIdle({ db, provider, appOrigin: 'http://localhost:3100', from: 'Passline <p@localhost>' });
    expect(observed).toEqual([[[{ revoked_at: null }], [{ revoked_at: null }]]]);
  });
});

describe('tombstone (SPEC §5.1, v2 tables)', () => {
  it('T-ADM-05 (v2): deleting a participant deletes the profile, revokes keys (deleted) and ends sessions', async () => {
    const p = await acceptedWithEmail();
    await f.pool.query(`update profiles set nickname = 'Ada', bio = 'hello' where participant_id = $1`, [p.id]);
    const cookie = await me.signIn(p.key);
    const { rows } = await f.pool.query<{ r: { code: string } }>('select delete_participant($1, $2, $3) as r', [f.e1.id, p.id, f.staff.org1]);
    expect(rows[0]?.r.code).toBe('DELETED');
    expect((await f.pool.query('select 1 from profiles where participant_id = $1', [p.id])).rows).toEqual([]);
    const keys = await f.pool.query('select revoke_reason from profile_keys where participant_id = $1', [p.id]);
    expect(keys.rows).toEqual([{ revoke_reason: 'deleted' }]);
    expect(await liveSessions(p.id)).toBe(0);
    expect((await me.call('me', { method: 'GET', cookie })).status).toBe(401);
  });
});
