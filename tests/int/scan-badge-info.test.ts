import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanApi } from '../fixtures/scan-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// PLAN F20 / §9.1: a door ACCEPTED tells the scanner whether the person already wears a badge.
let f: StandardFixture;
let vol1: string;
const api = scanApi();

beforeAll(async () => {
  f = await createStandardFixture();
  await f.addBadges(); // A wears T1
  vol1 = await signInAs(f.staffEmail.vol1);
});
afterAll(async () => {
  await f.close();
});

describe('door ACCEPTED badge info (V4c)', () => {
  it('T-SCAN2-14: door ACCEPTED includes hasBadge and badgeLabel; other results and checkpoints do not', async () => {
    const withBadge = await api.scan(vol1, { checkpointId: f.cp.D, method: 'qr', token: f.token.A });
    expect(withBadge.body).toMatchObject({ code: 'ACCEPTED', hasBadge: true, badgeLabel: 'T1' });

    const n = await f.addParticipant(f.e1.id);
    const without = await api.scan(vol1, { checkpointId: f.cp.D, method: 'manual', participantId: n.id });
    expect(without.body).toMatchObject({ code: 'ACCEPTED', hasBadge: false, badgeLabel: null });

    const again = await api.scan(vol1, { checkpointId: f.cp.D, method: 'manual', participantId: n.id });
    expect(again.body.code).toBe('ALREADY_SCANNED');
    expect(again.body).not.toHaveProperty('hasBadge');

    const raffle = await api.scan(vol1, { checkpointId: f.cp.R, method: 'qr', token: f.token.A });
    expect(raffle.body.code).toBe('ACCEPTED');
    expect(raffle.body).not.toHaveProperty('hasBadge');
    expect(raffle.body).not.toHaveProperty('badgeLabel');
  });
});
