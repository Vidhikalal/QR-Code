// `pnpm seed`: a demo event with 50 fake accepted participants and their QR PNGs in ./.seed/, plus 60
// badges (B-0001…) with the first 20 linked, and their printed-QR PNGs in ./.seed/badges/.
// Local Supabase only. Uses supabase-js directly (no server-only modules) so it runs under tsx.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { writeUniqueFile } from '@/lib/dev/files';
import { toFileLabel } from '@/lib/domain/file-label';
import { normalizeEmail, toSearchText } from '@/lib/domain/normalize';
import { generateToken, sha256hex } from '@/lib/domain/token';
import { randomBytes } from 'node:crypto';
import { tagUrl } from '@/lib/badge/tags';
import { renderQrPng } from '@/lib/qr/render';

const SLUG = 'demo';
const EVENT_NAME = 'Demo Hack Day';
const FIRST = ['Ada', 'Zoë', 'Liam', 'Priya', 'Mateo', 'Aisha', 'Kenji', 'Sofía', 'Noah', 'Chloé'];
const LAST = ["O'Brien", 'Nguyen', 'Okafor', 'Smith', 'García', 'Kowalski', 'Haddad', 'Li', 'Martin', 'Adebayo'];

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
  const participantIds: string[] = [];

  // .seed/ only ever holds this script's output; clear images from earlier runs so names start at 1.
  const dir = join(process.cwd(), '.seed');
  await rm(dir, { recursive: true, force: true });
  for (let i = 0; i < 50; i++) {
    const first = FIRST[i % FIRST.length] ?? 'Demo';
    const last = LAST[Math.floor(i / FIRST.length) % LAST.length] ?? 'Person';
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
        dietary_notes: i % 7 === 0 ? 'Vegetarian' : null,
        status: 'accepted',
        source: 'seed',
      })
      .select('id')
      .single();
    if (p.error) throw p.error;
    participantIds.push(p.data.id);
    const token = generateToken();
    const pass = await db.rpc('issue_pass', { p_participant_id: p.data.id, p_token_hash: sha256hex(token) });
    if (pass.error) throw pass.error;
    // "<Event>-<First>.png", with -2, -3… for repeated first names (same scheme as .mail/qr/).
    await writeUniqueFile(dir, toFileLabel(EVENT_NAME, first), '.png', await renderQrPng(`${origin}/p#${token}`));
  }
  // PLAN §11.5: 60 badges through the real SQL functions (reserve → confirm with a fake chip serial);
  // the first 20 are linked to the first 20 people. Printed QRs make NFC-less testing possible.
  const badgeDir = join(dir, 'badges');
  for (let i = 0; i < 60; i++) {
    const publicId = randomBytes(9).toString('base64url');
    const reserved = await db.rpc('reserve_tag', { p_event_id: eventId, p_staff_id: organizerId, p_public_id: publicId });
    if (reserved.error) throw reserved.error;
    const label = (reserved.data as { label?: string }).label ?? `B-${i + 1}`;
    const uid = `04${randomBytes(6).toString('hex').toUpperCase()}`;
    const confirmed = await db.rpc('register_tag', { p_event_id: eventId, p_staff_id: organizerId, p_public_id: publicId, p_uid: uid });
    if (confirmed.error || confirmed.data !== 'REGISTERED') throw new Error(`register_tag: ${confirmed.error?.message ?? String(confirmed.data)}`);
    const who = participantIds[i];
    if (i < 20 && who) {
      // p_uid is SQL null (look the badge up by public id); the generated types call every argument a string.
      const linked = await db.rpc('assign_tag', { p_event_id: eventId, p_staff_id: organizerId, p_participant_id: who, p_public_id: publicId, p_uid: null as unknown as string });
      if (linked.error) throw linked.error;
    }
    await writeUniqueFile(badgeDir, toFileLabel(EVENT_NAME, label), '.png', await renderQrPng(tagUrl(origin, publicId)));
  }
  console.log(`Badges: 60 registered (B-0001…B-0060), 20 linked. Printed QRs: .seed/badges/${toFileLabel(EVENT_NAME)}-B-0001.png …`);
  console.log(`Seeded event "${SLUG}" with 4 checkpoints and 50 participants. QR codes: .seed/${toFileLabel(EVENT_NAME)}-<First>.png`);
  console.log('Staff: organizer@example.test (organizer), volunteer@example.test (invite). Sign-in links arrive in Mailpit at http://127.0.0.1:54324.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
