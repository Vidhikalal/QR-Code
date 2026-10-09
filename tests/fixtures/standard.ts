import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type pg from 'pg';
import { generateToken, sha256hex } from '@/lib/domain/token';
import type { ScanCode, VoidCode } from '@/lib/domain/scan-codes';
import { createPool, requireEnv } from './db';

// SPEC §14 standard fixture. Every call creates a fresh pair of events under a unique slug,
// so test files never share data. Rows are left behind; `pnpm db:reset` clears them.

export const STAFF_PASSWORD = 'fixture-password-123';

export interface ScanResult {
  code: ScanCode;
  replayed?: boolean;
  voided?: boolean;
  scanId?: string;
  participant?: {
    id: string;
    displayName: string;
    photoPath: string | null;
    status: string;
    dietaryNotes?: string | null;
  };
  previous?: { scannedAt: string; scannedByName: string | null; scannedByMe: boolean };
  reissued?: boolean;
  revokeReason?: string;
  otherEvent?: string;
  capacity?: number;
  servingNo?: number;
  servedCount?: number;
  points?: number;
  tagId?: string;
  tagLabel?: string | null;
  retiredAt?: string;
}

export interface VoidResult {
  code: VoidCode;
}

export interface ScanArgs {
  cp: string;
  staff: string;
  token?: string;
  participantId?: string;
  /** Badge scan (method 'nfc'): by URL id, chip serial, or both. */
  tagPublicId?: string;
  tagUid?: string;
  confirmRepeat?: boolean;
  clientScanId?: string;
  clientScannedAt?: string | null;
  db?: pg.Pool | pg.PoolClient;
}

type Who = 'A' | 'B' | 'C' | 'Rv' | 'Wd' | 'T' | 'X' | 'N';
export type BadgeName = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9';
export interface Badge {
  id: string;
  publicId: string;
  uid: string;
  label: string;
}
export interface Badges {
  tag: Record<BadgeName, Badge>;
  /** org1's own badge row (ensure_staff_attendee), wearing T3. */
  orgRow: string;
}
type Staff = 'org1' | 'vol1' | 'vol2' | 'vol3';

export interface StandardFixture {
  slug: string;
  e1: { id: string; name: string };
  e2: { id: string; name: string };
  cp: { D: string; L: string; W: string; R: string; G: string; D2: string };
  p: Record<Who, string>;
  /** Active raw tokens (C has none). */
  token: Record<Exclude<Who, 'C'>, string>;
  /** Rv's first token, revoked with reason 'rotated'. */
  rvOldToken: string;
  staff: Record<Staff, string>;
  staffEmail: Record<Staff, string>;
  pool: pg.Pool;
  scan(args: ScanArgs): Promise<ScanResult>;
  /** PLAN §15.1 tapBadge: record_scan with method 'nfc' (by public id unless `byUid`). */
  tapBadge(staff: string, cp: string, tag: Badge, opts?: { byUid?: boolean; confirmRepeat?: boolean; clientScanId?: string; db?: pg.Pool | pg.PoolClient }): Promise<ScanResult>;
  issuePass(participantId: string, db?: pg.Pool | pg.PoolClient): Promise<{ passId: string; token: string }>;
  voidScan(scanId: string, staff: string, reason?: string): Promise<VoidResult>;
  addParticipant(eventId: string, opts?: { status?: string; withPass?: boolean }): Promise<{ id: string; token?: string }>;
  checkIn(participantId: string, token?: string): Promise<void>;
  /** A fresh signed-up user with a display name and no event roles. */
  addUser(label: string): Promise<{ id: string; email: string }>;
  /**
   * PLAN §15.1 badges, created on demand: T1–T8 registered on E1 (T1, T2, T3 linked to A, B and org1's
   * own badge row), T9 on E2. Uids are fake 7-byte serials.
   */
  addBadges(): Promise<Badges>;
  /** A fresh user linked as a platform admin (PLAN §6.2). Not staff on any event. */
  addPlatformAdmin(): Promise<{ id: string; email: string }>;
  close(): Promise<void>;
}

async function createStaffUser(email: string): Promise<string> {
  const admin = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.createUser({ email, password: STAFF_PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

export async function createStandardFixture(opts: { poolSize?: number } = {}): Promise<StandardFixture> {
  const pool = createPool(opts.poolSize ?? 4);
  const slug = `t-${randomBytes(6).toString('hex')}`;
  const one = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T> => {
    const { rows } = await pool.query<T>(sql, params);
    const row = rows[0];
    if (!row) throw new Error(`fixture query returned no rows: ${sql}`);
    return row;
  };

  const event = async (s: string, name: string) =>
    one<{ id: string }>(
      `insert into events (slug, name, venue, starts_at, ends_at)
       values ($1, $2, 'Fixture Hall', now(), now() + interval '1 day') returning id`,
      [s, name],
    );
  const e1 = { ...(await event(slug, `Fixture ${slug} One`)), name: `Fixture ${slug} One` };
  const e2 = { ...(await event(`${slug}-2`, `Fixture ${slug} Two`)), name: `Fixture ${slug} Two` };

  const checkpoint = async (eventId: string, name: string, kind: string, requiresCheckin: boolean, capacity: number | null, points = 0) =>
    (
      await one<{ id: string }>(
        `insert into checkpoints (event_id, name, kind, requires_checkin, capacity, is_open, points)
         values ($1, $2, $3, $4, $5, true, $6) returning id`,
        [eventId, name, kind, requiresCheckin, capacity, points],
      )
    ).id;
  // PLAN §15.1: W is worth 10 points; G is a custom activity (no check-in) worth 5.
  const cp = {
    D: await checkpoint(e1.id, 'Door', 'door', false, null),
    L: await checkpoint(e1.id, 'Lunch', 'meal', true, null),
    W: await checkpoint(e1.id, 'Workshop', 'session', true, 2, 10),
    R: await checkpoint(e1.id, 'Raffle', 'custom', false, null),
    G: await checkpoint(e1.id, 'Games', 'custom', false, null, 5),
    D2: await checkpoint(e2.id, 'Door', 'door', false, null),
  };

  const issuePass = async (participantId: string, db: pg.Pool | pg.PoolClient = pool) => {
    const token = generateToken();
    const { rows } = await db.query<{ id: string }>('select issue_pass($1, $2) as id', [participantId, sha256hex(token)]);
    const passId = rows[0]?.id;
    if (!passId) throw new Error('issue_pass returned nothing');
    return { passId, token };
  };

  let seq = 0;
  const participant = async (eventId: string, first: string, status: string, extra: { isTest?: boolean; dietary?: string } = {}) => {
    seq += 1;
    return (
      await one<{ id: string }>(
        `insert into participants (event_id, external_id, email, first_name, last_name, search_text, dietary_notes, status, source, is_test)
         values ($1, $2, $3, $4, 'Fixture', $5, $6, $7, 'seed', $8) returning id`,
        [
          eventId,
          randomUUID(),
          `p${seq}-${randomBytes(4).toString('hex')}@${slug}.test`,
          first,
          `${first.toLowerCase()} fixture`,
          extra.dietary ?? null,
          status,
          extra.isTest ?? false,
        ],
      )
    ).id;
  };

  const p = {
    A: await participant(e1.id, 'Ada', 'accepted', { dietary: 'Vegetarian' }),
    B: await participant(e1.id, 'Ben', 'accepted'),
    C: await participant(e1.id, 'Cy', 'waitlisted'),
    Rv: await participant(e1.id, 'Rae', 'accepted'),
    Wd: await participant(e1.id, 'Wes', 'accepted'),
    T: await participant(e1.id, 'Tess', 'accepted', { isTest: true }),
    X: await participant(e2.id, 'Xan', 'accepted'),
    N: await participant(e1.id, 'Nia', 'accepted'),
  };

  const rvOld = await issuePass(p.Rv);
  const token = {
    A: (await issuePass(p.A)).token,
    B: (await issuePass(p.B)).token,
    Rv: (await issuePass(p.Rv)).token,
    Wd: (await issuePass(p.Wd)).token,
    T: (await issuePass(p.T)).token,
    X: (await issuePass(p.X)).token,
    N: (await issuePass(p.N)).token,
  };
  await pool.query(`update participants set status = 'withdrawn' where id = $1`, [p.Wd]);
  await pool.query(
    `update passes set revoked_at = now(), revoke_reason = 'status_change' where participant_id = $1 and revoked_at is null`,
    [p.Wd],
  );

  const staffEmail = {
    org1: `org1@${slug}.test`,
    vol1: `vol1@${slug}.test`,
    vol2: `vol2@${slug}.test`,
    vol3: `vol3@${slug}.test`,
  };
  const staff = {
    org1: await createStaffUser(staffEmail.org1),
    vol1: await createStaffUser(staffEmail.vol1),
    vol2: await createStaffUser(staffEmail.vol2),
    vol3: await createStaffUser(staffEmail.vol3),
  };
  const staffRows: Array<[string, string, string, string]> = [
    [e1.id, staff.org1, 'organizer', 'Org One'],
    [e1.id, staff.vol1, 'volunteer', 'Vol One'],
    [e1.id, staff.vol2, 'volunteer', 'Vol Two'],
    [e2.id, staff.vol3, 'volunteer', 'Vol Three'],
  ];
  for (const [eventId, userId, role, name] of staffRows) {
    await pool.query('insert into staff_profiles (user_id, display_name) values ($1, $2)', [userId, name]);
    await pool.query('insert into event_staff (event_id, user_id, role) values ($1, $2, $3)', [eventId, userId, role]);
  }

  const scan = async (args: ScanArgs): Promise<ScanResult> => {
    const method = args.token !== undefined ? 'qr' : args.tagPublicId !== undefined || args.tagUid !== undefined ? 'nfc' : 'manual';
    const { rows } = await (args.db ?? pool).query<{ r: ScanResult }>(
      'select record_scan($1, $2, $3::scan_method, $4, $5, $6, $7, $8, $9, $10) as r',
      [
        args.cp,
        args.staff,
        method,
        args.token !== undefined ? sha256hex(args.token) : null,
        args.participantId ?? null,
        args.tagPublicId ?? null,
        args.tagUid ?? null,
        args.clientScanId ?? randomUUID(),
        args.clientScannedAt === undefined ? new Date().toISOString() : args.clientScannedAt,
        args.confirmRepeat ?? false,
      ],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error('record_scan returned nothing');
    return r;
  };

  const tapBadge: StandardFixture['tapBadge'] = (staffId, checkpointId, tag, o = {}) =>
    scan({
      cp: checkpointId,
      staff: staffId,
      ...(o.byUid ? { tagUid: tag.uid } : { tagPublicId: tag.publicId }),
      ...(o.confirmRepeat !== undefined && { confirmRepeat: o.confirmRepeat }),
      ...(o.clientScanId !== undefined && { clientScanId: o.clientScanId }),
      ...(o.db && { db: o.db }),
    });

  const voidScan = async (scanId: string, staffId: string, reason = 'Test scan') => {
    const { rows } = await pool.query<{ r: VoidResult }>('select void_scan($1, $2, $3) as r', [scanId, staffId, reason]);
    const r = rows[0]?.r;
    if (!r) throw new Error('void_scan returned nothing');
    return r;
  };

  const addParticipant = async (eventId: string, o: { status?: string; withPass?: boolean } = {}) => {
    const id = await participant(eventId, 'Extra', o.status ?? 'accepted');
    return o.withPass === false ? { id } : { id, token: (await issuePass(id)).token };
  };

  const checkIn = async (participantId: string, tok?: string) => {
    const r = await scan(
      tok !== undefined ? { cp: cp.D, staff: staff.org1, token: tok } : { cp: cp.D, staff: staff.org1, participantId },
    );
    if (r.code !== 'ACCEPTED') throw new Error(`fixture check-in failed: ${r.code}`);
  };

  const addBadges = async (): Promise<Badges> => {
    const make = async (eventId: string, n: number): Promise<Badge> => {
      const publicId = randomBytes(9).toString('base64url');
      const uid = `04${randomBytes(6).toString('hex').toUpperCase()}`;
      const label = `T${n}`;
      const row = await one<{ id: string }>(
        `insert into tags (event_id, public_id, uid, label, registered_by) values ($1, $2, $3, $4, $5) returning id`,
        [eventId, publicId, uid, label, staff.org1],
      );
      return { id: row.id, publicId, uid, label };
    };
    const tag = {} as Record<BadgeName, Badge>;
    for (let n = 1; n <= 8; n++) tag[`T${n}` as BadgeName] = await make(e1.id, n);
    tag.T9 = await make(e2.id, 9);
    const org = await one<{ r: { participantId: string } }>('select ensure_staff_attendee($1, $2, $3) as r', [e1.id, staff.org1, 'org one']);
    const orgRow = org.r.participantId;
    for (const [who, t] of [[p.A, tag.T1], [p.B, tag.T2], [orgRow, tag.T3]] as const) {
      const r = await one<{ r: { code: string } }>('select assign_tag($1, $2, $3, $4, null, false) as r', [e1.id, staff.org1, who, t.publicId]);
      if (r.r.code !== 'ASSIGNED') throw new Error(`fixture badge link failed: ${r.r.code}`);
    }
    return { tag, orgRow };
  };

  let users = 0;
  const addUser = async (label: string) => {
    users += 1;
    const email = `${label}${users}@${slug}.test`;
    const id = await createStaffUser(email);
    await pool.query('insert into staff_profiles (user_id, display_name) values ($1, $2)', [id, `${label} ${users}`]);
    return { id, email };
  };
  const addPlatformAdmin = async () => {
    const u = await addUser('admin');
    await pool.query('insert into platform_admins (email, user_id) values ($1, $2)', [u.email, u.id]);
    return u;
  };

  return {
    slug,
    e1,
    e2,
    cp,
    p,
    token,
    rvOldToken: rvOld.token,
    staff,
    staffEmail,
    pool,
    scan,
    tapBadge,
    issuePass,
    voidScan,
    addParticipant,
    checkIn,
    addUser,
    addBadges,
    addPlatformAdmin,
    close: () => pool.end(),
  };
}
