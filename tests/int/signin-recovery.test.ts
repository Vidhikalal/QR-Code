import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { createSigninCodeApi } from '@/lib/participant/signin-code';
import { serviceClient } from '../fixtures/mail';
import { ME_ORIGIN, participantClient } from '../fixtures/participant-api';
import { asBearer, bearerAuth, signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN F18 recovery paths (V2b): "Email me a link" and staff hand-off sign-in codes.
let f: StandardFixture;
let vol1: string;
let vol3: string;
const me = participantClient();
const codes = createSigninCodeApi({ db: serviceClient(), authenticate: bearerAuth, meOrigin: ME_ORIGIN });

beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 12 });
  [vol1, vol3] = await Promise.all([signInAs(f.staffEmail.vol1), signInAs(f.staffEmail.vol3)]);
});
afterAll(async () => {
  await f.close();
});

async function emailOf(id: string): Promise<string> {
  const { rows } = await f.pool.query<{ email: string }>('select email from participants where id = $1', [id]);
  return rows[0]?.email ?? '';
}

const profileLinks = async (participantId: string) =>
  (await f.pool.query<{ n: number }>(`select count(*)::int as n from email_outbox where participant_id = $1 and kind = 'profile_link'`, [participantId])).rows[0]?.n ?? 0;

async function issueCode(jwt: string | null, participantId: string) {
  const res = await codes.issue(new Request('http://localhost/api/participants/x/signin-code', { method: 'POST', headers: asBearer(jwt) }), { id: participantId });
  return { status: res.status, body: (await res.json()) as { url?: string; expiresAt?: string; error?: string } };
}

const codeFrom = (url: string | undefined) => url?.split('#')[1] ?? '';

describe('Email me a link (PLAN F18, §9.2)', () => {
  it('T-SESS-08: registered and unknown emails get byte-identical answers; only the registered one queues a link', async () => {
    const person = await f.addParticipant(f.e1.id, { withPass: false });
    const ip = `192.0.2.${randomBytes(4).toString('hex')}`;
    const known = await me.call('requestLink', { body: { eventSlug: f.slug, email: ` ${(await emailOf(person.id)).toUpperCase()} ` }, ip });
    const unknown = await me.call('requestLink', { body: { eventSlug: f.slug, email: `nobody-${randomBytes(3).toString('hex')}@${f.slug}.test` }, ip });
    const noEvent = await me.call('requestLink', { body: { eventSlug: 'no-such-event', email: await emailOf(person.id) }, ip });
    for (const r of [known, unknown, noEvent]) expect(r).toEqual({ status: 200, body: { code: 'SENT_IF_REGISTERED' }, setCookie: null });
    expect(await profileLinks(person.id)).toBe(1);
    expect(me.scheduled.length).toBeGreaterThan(0);
    // A second request while one is in flight queues nothing more.
    await me.call('requestLink', { body: { eventSlug: f.slug, email: await emailOf(person.id) }, ip });
    expect(await profileLinks(person.id)).toBe(1);
  });

  it('T-SESS-08: a waitlisted person gets the same answer and no email', async () => {
    const r = await me.call('requestLink', { body: { eventSlug: f.slug, email: await emailOf(f.p.C) } });
    expect(r.body).toEqual({ code: 'SENT_IF_REGISTERED' });
    expect(await profileLinks(f.p.C)).toBe(0);
  });

  it('T-SESS-08: the 4th request for one address in an hour is rate limited; bad bodies are 400', async () => {
    const email = `limit-${randomBytes(4).toString('hex')}@${f.slug}.test`;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await me.call('requestLink', { body: { eventSlug: f.slug, email }, ip: `192.0.2.${i}-${email}` })).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect((await me.call('requestLink', { body: { eventSlug: f.slug, email: 'not-an-email' } })).status).toBe(400);
    expect((await me.call('requestLink', { body: { eventSlug: f.slug, email, extra: 1 } })).status).toBe(400);
  });

  it('T-HOST-03 / T-SEC2-06: a foreign or missing Origin is refused with no outbox row', async () => {
    const person = await f.addParticipant(f.e1.id, { withPass: false });
    for (const origin of ['https://evil.example', null]) {
      expect((await me.call('requestLink', { body: { eventSlug: f.slug, email: await emailOf(person.id) }, origin })).status).toBe(403);
      expect((await me.call('redeemCode', { body: { code: generateSecret() }, origin })).status).toBe(403);
    }
    expect(await profileLinks(person.id)).toBe(0);
  });
});

describe('staff hand-off sign-in codes (PLAN F18, §6.4)', () => {
  it('T-SESS-07: staff of another event get 403; signed out gets 401; the event volunteer gets a /signin#code URL', async () => {
    expect((await issueCode(null, f.p.A)).status).toBe(401);
    expect((await issueCode(vol3, f.p.A)).status).toBe(403);
    expect((await issueCode(vol1, f.p.C)).status).toBe(409); // waitlisted: not eligible
    expect((await issueCode(vol1, 'not-a-uuid')).status).toBe(404);
    const ok = await issueCode(vol1, f.p.A);
    expect(ok.status).toBe(200);
    expect(ok.body.url).toMatch(new RegExp(`^${ME_ORIGIN}/signin#[A-Za-z0-9_-]{43}$`));
    const msLeft = new Date(ok.body.expiresAt ?? 0).getTime() - Date.now();
    expect(msLeft).toBeGreaterThan(100_000);
    expect(msLeft).toBeLessThanOrEqual(120_000);
    const { rows } = await f.pool.query(
      `select detail from audit_log where subject_id = $1 and action = 'signin_code.issue' order by created_at desc limit 1`,
      [f.p.A],
    );
    expect(rows).toEqual([{ detail: { purpose: 'staff_handoff' } }]);
  });

  it('T-SESS-07: a code opens one session once; a second redemption and an expired code are CODE_INVALID', async () => {
    const code = codeFrom((await issueCode(vol1, f.p.B)).body.url);
    const first = await me.call('redeemCode', { body: { code } });
    expect(first.body).toEqual({ code: 'OPENED', next: '/me' });
    expect(first.setCookie).toMatch(/^pl_me=[A-Za-z0-9_-]{43}; /);
    expect((await me.call('redeemCode', { body: { code } })).body).toEqual({ code: 'CODE_INVALID' });

    const late = codeFrom((await issueCode(vol1, f.p.B)).body.url);
    await f.pool.query(`update signin_codes set expires_at = now() - interval '1 second' where code_hash = $1`, [sha256hex(late)]);
    expect((await me.call('redeemCode', { body: { code: late } })).body).toEqual({ code: 'CODE_INVALID' });
    expect((await me.call('redeemCode', { body: { code: generateSecret() } })).body).toEqual({ code: 'CODE_INVALID' });
  });

  it('T-CONC2-07: one code redeemed 10× in parallel opens exactly one session', async () => {
    const code = codeFrom((await issueCode(vol1, f.p.N)).body.url);
    const clients = await Promise.all(Array.from({ length: 10 }, () => f.pool.connect()));
    try {
      const results = await Promise.all(
        clients.map((c) =>
          c.query<{ r: { code: string } }>(`select redeem_signin_code($1, $2, interval '1 day') as r`, [sha256hex(code), sha256hex(generateSecret())]),
        ),
      );
      const got = results.map((r) => r.rows[0]?.r.code).sort();
      expect(got).toEqual(['CODE_INVALID', 'CODE_INVALID', 'CODE_INVALID', 'CODE_INVALID', 'CODE_INVALID', 'CODE_INVALID', 'CODE_INVALID', 'CODE_INVALID', 'CODE_INVALID', 'OPENED']);
    } finally {
      for (const c of clients) c.release();
    }
    const { rows } = await f.pool.query<{ n: number }>(`select count(*)::int as n from participant_sessions where participant_id = $1 and via = 'signin_code'`, [f.p.N]);
    expect(rows[0]?.n).toBe(1);
  });
});
