import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { passToken, sha256hex } from '@/lib/domain/token';
import { myPasses } from '@/lib/pass/mine';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
const secret = 'test-secret-for-my-passes-000000000000';
beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

const emailOf = async (id: string) =>
  (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]?.email ?? '';
const mine = (email: string) => myPasses(serviceClient(), email, secret, new Date());

describe('/me (SPEC §6.1, v0.4)', () => {
  it('T-ME-01: shows only your own accepted passes, with a token that matches the stored hash', async () => {
    const a = await emailOf(f.p.A);
    // A's fixture pass has a random token (as before v0.4): it can't be shown again.
    expect((await mine(a)).map((p) => p.pass)).toEqual(['in_email']);

    const passId = randomUUID();
    const token = passToken(secret, passId);
    await f.pool.query('select issue_pass($1, $2, $3)', [f.p.A, sha256hex(token), passId]);
    const [only, ...rest] = await mine(` ${a.toUpperCase()} `);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ participantId: f.p.A, pass: { token } });
    expect(only?.event.name).toBeTruthy();

    // Accepted but not issued yet (an RSVP Yes waiting on the outbox): "on its way".
    await f.pool.query(`update passes set revoked_at = now(), revoke_reason = 'manual' where participant_id = $1`, [f.p.A]);
    expect((await mine(a)).map((p) => p.pass)).toEqual(['on_its_way']);

    // Waitlisted, withdrawn, deleted, another event's past: nothing.
    expect(await mine(await emailOf(f.p.C))).toEqual([]);
    expect(await mine(await emailOf(f.p.Wd))).toEqual([]);
    await f.pool.query(`update events set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = $1`, [f.e2.id]);
    expect(await mine(await emailOf(f.p.X))).toEqual([]);
  });
});
