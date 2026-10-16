import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, obj } from '../fixtures/admin-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let org: string;
const c = adminClient();
beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

describe('staff admin (SPEC F9)', () => {
  it('F9: inviting an existing user adds them directly; a new email becomes a pending invite (normalized)', async () => {
    const existing = await c.call('inviteStaff', org, { slug: f.slug }, { body: { email: f.staffEmail.vol3.toUpperCase(), role: 'volunteer' } });
    expect(existing.body).toEqual({ code: 'ADDED' });
    const fresh = await c.call('inviteStaff', org, { slug: f.slug }, { body: { email: ` New+${f.slug}@Example.TEST `, role: 'organizer' } });
    // T-AUTH-03 (I): a new address also gets an email from the auth server to set a password.
    expect(fresh.body).toEqual({ code: 'INVITED', emailed: true });
    const { rows: accounts } = await f.pool.query('select 1 from auth.users where email = $1', [`new+${f.slug}@example.test`]);
    expect(accounts).toHaveLength(1);
    const list = await c.call('listStaff', org, { slug: f.slug });
    const staff = obj(list.body).staff as Array<{ userId: string; role: string; displayName: string | null }>;
    expect(staff.find((s) => s.userId === f.staff.vol3)).toMatchObject({ role: 'volunteer', displayName: 'Vol Three' });
    expect(obj(list.body).invites).toEqual([{ email: `new+${f.slug}@example.test`, role: 'organizer' }]);
    expect((await c.call('inviteStaff', org, { slug: f.slug }, { body: { email: 'nope', role: 'volunteer' } })).status).toBe(400);
    const cancelled = await c.call('cancelInvite', org, { slug: f.slug, email: `new+${f.slug}@example.test` }, { method: 'DELETE' });
    expect(cancelled.status).toBe(200);
  });

  it('F9 (v0.4): re-inviting an invited-but-not-signed-in address as volunteer drops the old organizer invite', async () => {
    const email = `twice-${f.slug}@example.test`;
    expect((await c.call('inviteStaff', org, { slug: f.slug }, { body: { email, role: 'organizer' } })).body).toMatchObject({ code: 'INVITED' });
    // The invite email made an account (no password yet), so the second invite adds them directly.
    expect((await c.call('inviteStaff', org, { slug: f.slug }, { body: { email, role: 'volunteer' } })).body).toEqual({ code: 'ADDED' });
    const { rows: invites } = await f.pool.query('select role from staff_invites where event_id = $1 and email = $2', [f.e1.id, email]);
    expect(invites).toEqual([]);
    const { rows: users } = await f.pool.query<{ id: string }>('select id from auth.users where email = $1', [email]);
    await f.pool.query('select consume_staff_invites($1, $2)', [users[0]?.id, email]);
    const { rows } = await f.pool.query('select role from event_staff where event_id = $1 and user_id = $2', [f.e1.id, users[0]?.id]);
    expect(rows).toEqual([{ role: 'volunteer' }]);
  });

  it('F9: removing a volunteer takes effect on their next scan; the last organizer cannot be removed', async () => {
    expect((await c.call('removeStaff', org, { slug: f.slug, userId: f.staff.vol2 }, { method: 'DELETE' })).body).toEqual({ code: 'REMOVED' });
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol2, token: f.token.A })).code).toBe('FORBIDDEN');
    const last = await c.call('removeStaff', org, { slug: f.slug, userId: f.staff.org1 }, { method: 'DELETE' });
    expect(last.status).toBe(409);
    expect(last.body).toEqual({ code: 'LAST_ORGANIZER' });
  });
});
