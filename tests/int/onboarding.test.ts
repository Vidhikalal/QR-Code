import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { landingAfterSignIn, needsOnboarding } from '@/lib/auth/onboarding';
import { requireEnv } from '../fixtures/db';
import { serviceClient } from '../fixtures/mail';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F9 (v0.3): the display-name step is for staff only. Attendees sign in to view badge
// profiles (§6.5) and must go straight back to where they came from.
let f: StandardFixture;
beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

describe('auth callback onboarding (SPEC F9)', () => {
  it('T-NFC-18: only staff without a display name are sent to onboarding', async () => {
    const db = serviceClient();
    expect(await needsOnboarding(db, f.staff.vol1)).toBe(false);

    await f.pool.query('delete from staff_profiles where user_id = $1', [f.staff.vol2]);
    expect(await needsOnboarding(db, f.staff.vol2)).toBe(true);

    const admin = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.createUser({ email: `attendee@${f.slug}.test`, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message ?? 'no user'}`);
    expect(await needsOnboarding(db, data.user.id)).toBe(false);
  });

  it('T-AUTH-06: an ADMIN_EMAILS account becomes organizer on every event at sign-in; others get nothing', async () => {
    const db = serviceClient();
    const adminEmail = `admin@${f.slug}.test`;
    const admin = await createAccount(adminEmail);
    const other = await createAccount(`not-admin@${f.slug}.test`);
    try {
      await f.pool.query(`insert into event_staff (event_id, user_id, role) values ($1, $2, 'volunteer')`, [f.e1.id, admin]);
      const admins = [adminEmail];

      // Staff without a display name still get onboarding first.
      expect(await landingAfterSignIn(db, { id: admin, email: adminEmail.toUpperCase() }, '/me', admins)).toBe('/onboarding?next=%2Fme');
      const { rows } = await f.pool.query<{ event_id: string; role: string }>(
        'select event_id, role from event_staff where user_id = $1',
        [admin],
      );
      const { rows: events } = await f.pool.query<{ n: number }>('select count(*)::int as n from events');
      expect(rows).toHaveLength(events[0]?.n ?? -1);
      expect(rows.every((r) => r.role === 'organizer')).toBe(true); // the volunteer row was upgraded
      expect(rows.map((r) => r.event_id)).toEqual(expect.arrayContaining([f.e1.id, f.e2.id]));

      expect(await landingAfterSignIn(db, { id: other, email: `not-admin@${f.slug}.test` }, '/me', admins)).toBe('/me');
      const { rowCount } = await f.pool.query('select 1 from event_staff where user_id = $1', [other]);
      expect(rowCount).toBe(0);
    } finally {
      // Deleting the accounts removes their roles (FK cascade), so no other test sees them.
      for (const id of [admin, other]) await db.auth.admin.deleteUser(id);
    }
  });
});
