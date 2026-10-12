// `pnpm seed`: a demo event with 10 accepted applicants whose acceptance emails (pass QR + "Set up your
// profile") are sent through the real outbox and drainer to EMAIL_PROVIDER (Mailpit at
// http://127.0.0.1:54324, or .mail/ with console), plus 60 badges (B-0001…), none linked, with printed
// QRs in ./.seed/badges/. With SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD in .env.local it also (re)creates
// that platform admin, organizer of the demo event (sign in with the password; FEATURE_PASSWORD_LOGIN).
// Local Supabase only. Uses supabase-js directly (no server-only modules) so it runs under tsx.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { writeUniqueFile } from '@/lib/dev/files';
import { toFileLabel } from '@/lib/domain/file-label';
import { normalizeEmail, toSearchText } from '@/lib/domain/normalize';
import { randomBytes } from 'node:crypto';
import { createConsoleProvider } from '@/lib/email/console';
import { drainUntilIdle } from '@/lib/email/drain';
import { createMailpitProvider } from '@/lib/email/mailpit';
import type { EmailProvider } from '@/lib/email/provider';
import { tagUrl } from '@/lib/badge/tags';
import { renderQrPng } from '@/lib/qr/render';

const SLUG = 'demo';
const EVENT_NAME = 'Demo Hack Day';
// Ten applicants with unique first names, so every pass, email and badge is easy to tell apart.
const PEOPLE: ReadonlyArray<readonly [string, string, string | null]> = [
  ['Ada', 'Okafor', 'Vegetarian'],
  ['Ben', 'Nguyen', null],
  ['Chloé', 'Martin', null],
  ['Diego', 'García', 'No nuts'],
  ['Emma', 'Smith', null],
  ['Farah', 'Haddad', 'Halal'],
  ['Gabe', "O'Brien", null],
  ['Hana', 'Li', null],
  ['Ivan', 'Kowalski', null],
  ['Jade', 'Adebayo', 'Vegan'],
];

// Seeds never send real email: Mailpit (local inbox) or .mail/ files only.
function seedProvider(): EmailProvider {
  const kind = process.env.EMAIL_PROVIDER ?? 'console';
  if (kind === 'mailpit') return createMailpitProvider({ url: process.env.MAILPIT_URL || 'http://127.0.0.1:54324' });
  if (kind !== 'console') throw new Error(`pnpm seed only sends to Mailpit or .mail/ (EMAIL_PROVIDER=${kind}); use mailpit or console`);
  return createConsoleProvider();
}

// The local admin from .env.local (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD): a platform admin who can
// create events, organizer of the demo event, signing in with the password (FEATURE_PASSWORD_LOGIN).
async function ensureAdmin(db: ReturnType<typeof createClient<Database>>, eventId: string): Promise<string | null> {
  const raw = process.env.SEED_ADMIN_EMAIL;
  if (!raw) return null;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('SEED_ADMIN_PASSWORD is not set (expected next to SEED_ADMIN_EMAIL in .env.local)');
  const email = normalizeEmail(raw);
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  let id = created.data.user?.id;
  if (!id) {
    id = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email)?.id;
    if (!id) throw new Error(`could not create the admin account: ${created.error?.message ?? 'unknown'}`);
    const updated = await db.auth.admin.updateUserById(id, { password, email_confirm: true });
    if (updated.error) throw updated.error;
  }
  const admin = await db.from('platform_admins').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true });
  if (admin.error) throw admin.error;
  const linked = await db.rpc('consume_platform_admin', { p_user_id: id, p_email: email });
  if (linked.error) throw linked.error;
  const prof = await db.from('staff_profiles').upsert({ user_id: id, display_name: 'Admin' });
  if (prof.error) throw prof.error;
  const staff = await db.from('event_staff').upsert({ event_id: eventId, user_id: id, role: 'organizer' });
  if (staff.error) throw staff.error;
  return email;
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (expected in .env.local)`);
  return v;
}

async function main() {
  const url = need('NEXT_PUBLIC_SUPABASE_URL');
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('seed only runs against local Supabase');
  const origin = need('NEXT_PUBLIC_APP_ORIGIN');
  const db = createClient<Database>(url, need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  const existing = await db.from('events').select('id').eq('slug', SLUG).maybeSingle();
  if (existing.data) {
    console.log(`Event "${SLUG}" already exists. Run \`pnpm db:reset\` to start over.`);
    return;
  }

  const startsAt = new Date(Date.now() + 24 * 3600 * 1000);
  const event = await db
    .from('events')
    .insert({
      slug: SLUG,
      name: EVENT_NAME,
      venue: 'Demo Hall',
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 10 * 3600 * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (event.error) throw event.error;
  const eventId = event.data.id;

  const cps = await db.from('checkpoints').insert([
    { event_id: eventId, name: 'Door', kind: 'door', requires_checkin: false, is_open: true, sort_order: 0 },
    { event_id: eventId, name: 'Lunch', kind: 'meal', is_open: true, sort_order: 1 },
    { event_id: eventId, name: 'Workshop', kind: 'session', capacity: 20, is_open: true, sort_order: 2 },
    { event_id: eventId, name: 'Raffle', kind: 'custom', requires_checkin: false, is_open: true, sort_order: 3 },
  ], { defaultToNull: false });
  if (cps.error) throw cps.error;

  // Dev staff: sign in at /login with these addresses; the links land in Mailpit (http://127.0.0.1:54324).
  // The organizer account is created now (badges must be registered and linked by a staff member); the
  // volunteer is an invite, consumed on first sign-in as in production.
  const organizerEmail = normalizeEmail('organizer@example.test');
  const created = await db.auth.admin.createUser({ email: organizerEmail, email_confirm: true });
  const organizerId =
    created.data.user?.id ?? (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === organizerEmail)?.id;
  if (!organizerId) throw new Error(`could not create ${organizerEmail}: ${created.error?.message ?? 'unknown'}`);
  const prof = await db.from('staff_profiles').upsert({ user_id: organizerId, display_name: 'Demo Organizer' });
  if (prof.error) throw prof.error;
  const org = await db.from('event_staff').insert({ event_id: eventId, user_id: organizerId, role: 'organizer' });
  if (org.error) throw org.error;
  const invites = await db.from('staff_invites').insert([{ event_id: eventId, email: normalizeEmail('volunteer@example.test'), role: 'volunteer' }]);
  if (invites.error) throw invites.error;

  const adminEmail = await ensureAdmin(db, eventId);

  // .seed/ only ever holds this script's output; clear images from earlier runs so names start at 1.
  const dir = join(process.cwd(), '.seed');
  await rm(dir, { recursive: true, force: true });
  for (const [i, [first, last, dietary]] of PEOPLE.entries()) {
    const n = String(i + 1).padStart(2, '0');
    const p = await db
      .from('participants')
      .insert({
        event_id: eventId,
        external_id: `seed-${n}`,
        email: normalizeEmail(`demo${n}@example.test`),
        first_name: first,
        last_name: last,
        search_text: toSearchText(`${first} ${last}`),
        dietary_notes: dietary,
        status: 'accepted',
        source: 'seed',
      })
      .select('id')
      .single();
    if (p.error) throw p.error;
    // The acceptance email, the real way (F3/F4): queue it, the drainer below issues the pass and an
    // edit key (committed first, I-10) and sends it.
    const queued = await db.rpc('enqueue_pass', { p_event_id: eventId, p_participant_id: p.data.id, p_actor: organizerId });
    if (queued.error) throw queued.error;
  }
  const provider = seedProvider();
  const sent = await drainUntilIdle({ db, provider, appOrigin: origin, from: process.env.EMAIL_FROM || 'Passline <passes@localhost>' });
  // PLAN §11.5: 60 badges through the real SQL functions (reserve → confirm with a fake chip serial).
  // None is linked: badges are mandatory at the Door, so every seeded person gets one there (a real NFC
  // badge, or one of these printed QRs shown to the camera). Printed QRs make NFC-less testing possible.
  const badgeDir = join(dir, 'badges');
  for (let i = 0; i < 60; i++) {
    const publicId = randomBytes(9).toString('base64url');
    const reserved = await db.rpc('reserve_tag', { p_event_id: eventId, p_staff_id: organizerId, p_public_id: publicId });
    if (reserved.error) throw reserved.error;
    const label = (reserved.data as { label?: string }).label ?? `B-${i + 1}`;
    const uid = `04${randomBytes(6).toString('hex').toUpperCase()}`;
    const confirmed = await db.rpc('register_tag', { p_event_id: eventId, p_staff_id: organizerId, p_public_id: publicId, p_uid: uid });
    if (confirmed.error || confirmed.data !== 'REGISTERED') throw new Error(`register_tag: ${confirmed.error?.message ?? String(confirmed.data)}`);
    await writeUniqueFile(badgeDir, toFileLabel(EVENT_NAME, label), '.png', await renderQrPng(tagUrl(origin, publicId)));
  }
  console.log(`Badges: 60 registered (B-0001…B-0060), none linked: link one per person at the Door. Printed QRs: .seed/badges/${toFileLabel(EVENT_NAME)}-B-0001.png …`);
  console.log(`Seeded event "${SLUG}" with 4 checkpoints and ${PEOPLE.length} accepted applicants (${sent} acceptance emails processed).`);
  console.log(
    provider.name === 'mailpit'
      ? '  Their emails (pass QR + "Set up your profile") are in Mailpit: http://127.0.0.1:54324'
      : '  Their emails are in .mail/ (open the .eml files); pass QRs in .mail/qr/',
  );
  if (adminEmail) console.log(`  Admin: sign in at /login with ${adminEmail} and the password from .env.local.`);
  console.log('Staff: organizer@example.test (organizer), volunteer@example.test (invite). Sign-in links arrive in Mailpit at http://127.0.0.1:54324.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
