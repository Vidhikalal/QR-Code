import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanApi } from '../fixtures/scan-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §10.6 / §11 (v0.8): who was scanned at a checkpoint, for the event's staff, with Remove (= void, F11).
let f: StandardFixture;
let api: ReturnType<typeof scanApi>;
let org1: string;
let vol1: string;
let vol3: string;
beforeAll(async () => {
  f = await createStandardFixture();
  api = scanApi();
  [org1, vol1, vol3] = await Promise.all([signInAs(f.staffEmail.org1), signInAs(f.staffEmail.vol1), signInAs(f.staffEmail.vol3)]);
});
afterAll(async () => {
  await f.close();
});

type Row = { id: string; displayName: string; isTest: boolean; scannedAt: string; method: string; scannedByName: string | null; canRemove: boolean };
const rowsOf = (body: Record<string, unknown>) => body.scans as Row[];

describe('GET /api/events/[slug]/checkpoints/[id]/scans (SPEC §10.6, §11)', () => {
  it('T-SCAN-30: staff see who was scanned here (live only, newest first, no emails); Remove follows the void rules', async () => {
    const a = await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.A });
    const b = await f.scan({ cp: f.cp.R, staff: f.staff.vol2, token: f.token.B });
    const t = await f.scan({ cp: f.cp.R, staff: f.staff.org1, participantId: f.p.T });
    const old = await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.N });
    await f.pool.query(`update scans set scanned_at = now() - interval '5 minutes' where id = $1`, [old.scanId]);

    const asOrg = await api.checkpointScans(org1, f.slug, f.cp.R);
    expect(asOrg.status).toBe(200);
    const rows = rowsOf(asOrg.body);
    expect(rows.map((r) => r.id)).toEqual([t.scanId, b.scanId, a.scanId, old.scanId]);
    expect(rows.find((r) => r.id === a.scanId)).toMatchObject({ displayName: 'Ada Fixture', isTest: false, method: 'qr', scannedByName: 'Vol One', canRemove: true });
    expect(rows.find((r) => r.id === t.scanId)).toMatchObject({ isTest: true, method: 'manual', scannedByName: 'Org One' });
    expect(rows.every((r) => r.canRemove)).toBe(true); // organizers may void any scan
    expect(JSON.stringify(asOrg.body)).not.toContain('@');

    const asVol = await api.checkpointScans(vol1, f.slug, f.cp.R);
    expect(asVol.status).toBe(200);
    const canRemove = Object.fromEntries(rowsOf(asVol.body).map((r) => [r.id, r.canRemove]));
    // Own and under 120 s only (void_scan's rule): not vol2's, not the organizer's, not their own 5-minute-old scan.
    expect(canRemove).toEqual({ [a.scanId ?? '']: true, [b.scanId ?? '']: false, [t.scanId ?? '']: false, [old.scanId ?? '']: false });

    // A deleted (tombstoned) person drops off the list, like every count (§5.1, §13).
    const gone = await f.scan({ cp: f.cp.R, staff: f.staff.org1, token: f.token.Rv });
    expect(gone.code).toBe('ACCEPTED');
    expect(rowsOf((await api.checkpointScans(org1, f.slug, f.cp.R)).body).map((r) => r.id)).toContain(gone.scanId);
    await f.pool.query(`update participants set deleted_at = now(), first_name = 'Deleted', last_name = '' where id = $1`, [f.p.Rv]);
    expect(rowsOf((await api.checkpointScans(org1, f.slug, f.cp.R)).body).map((r) => r.id)).not.toContain(gone.scanId);

    expect((await api.checkpointScans(vol3, f.slug, f.cp.R)).status).toBe(403);
    expect((await api.checkpointScans(null, f.slug, f.cp.R)).status).toBe(401);
    expect((await api.checkpointScans(org1, f.slug, f.cp.D2)).status).toBe(404); // another event's checkpoint
    expect((await api.checkpointScans(org1, f.slug, 'not-a-uuid')).status).toBe(404);

    // Remove = the existing void: the row drops off and the person can be scanned again.
    expect((await api.voidScan(vol1, a.scanId ?? '', { reason: 'Test scan' })).body).toEqual({ code: 'VOIDED' });
    expect(rowsOf((await api.checkpointScans(org1, f.slug, f.cp.R)).body).map((r) => r.id)).toEqual([t.scanId, b.scanId, old.scanId]);
    expect((await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.A })).code).toBe('ACCEPTED');
  });
});
