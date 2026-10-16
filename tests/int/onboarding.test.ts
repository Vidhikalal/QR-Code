import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { needsOnboarding } from '@/lib/auth/onboarding';
import { requireEnv } from '../fixtures/db';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

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
});
