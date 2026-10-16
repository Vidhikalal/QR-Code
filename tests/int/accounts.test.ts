import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

const kind = async (email: string) =>
  (await f.pool.query<{ k: string }>('select password_link_kind($1) as k', [email])).rows[0]?.k;
const emailOf = async (id: string) =>
  (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]?.email ?? '';

describe('"Forgot or never set your password?" (SPEC F9/F12, v0.4)', () => {
  it('T-AUTH-02 (I): reset for an account, invite for an accepted participant or staff invite, none otherwise', async () => {
    expect(await kind(f.staffEmail.vol1.toUpperCase())).toBe('reset');
    const a = await emailOf(f.p.A);
    expect(await kind(` ${a} `)).toBe('invite');
    await createAccount(a);
    expect(await kind(a)).toBe('reset');

    const invited = `invite-${f.slug}@example.test`;
    await f.pool.query(`insert into staff_invites (event_id, email, role) values ($1, $2, 'volunteer')`, [f.e1.id, invited]);
    expect(await kind(invited)).toBe('invite');

    // Waitlisted, withdrawn and deleted participants, and strangers, get nothing.
    expect(await kind(await emailOf(f.p.C))).toBe('none');
    expect(await kind(await emailOf(f.p.Wd))).toBe('none');
    expect(await kind(`stranger-${f.slug}@example.test`)).toBe('none');
  });
});
