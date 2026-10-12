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

describe('door badge info (V4c; mandatory badges 2026-10-11)', () => {
  it('T-SCAN2-14: door ACCEPTED and ALREADY_SCANNED include hasBadge and badgeLabel; other results and checkpoints do not', async () => {
    const withBadge = await api.scan(vol1, { checkpointId: f.cp.D, method: 'qr', token: f.token.A });
    expect(withBadge.body).toMatchObject({ code: 'ACCEPTED', hasBadge: true, badgeLabel: 'T1' });

    const n = await f.addParticipant(f.e1.id);
    const without = await api.scan(vol1, { checkpointId: f.cp.D, method: 'manual', participantId: n.id });
    expect(without.body).toMatchObject({ code: 'ACCEPTED', hasBadge: false, badgeLabel: null });

    // Badges are mandatory: re-scanning the pass of someone still without one reopens the badge step.
    const again = await api.scan(vol1, { checkpointId: f.cp.D, method: 'manual', participantId: n.id });
    expect(again.body).toMatchObject({ code: 'ALREADY_SCANNED', hasBadge: false, badgeLabel: null });
    const againWithBadge = await api.scan(vol1, { checkpointId: f.cp.D, method: 'qr', token: f.token.A });
    expect(againWithBadge.body).toMatchObject({ code: 'ALREADY_SCANNED', hasBadge: true, badgeLabel: 'T1' });

    const notFound = await api.scan(vol1, { checkpointId: f.cp.D, method: 'manual', participantId: f.p.C }); // waitlisted
    expect(notFound.body.code).toBe('NOT_ACCEPTED');
    expect(notFound.body).not.toHaveProperty('hasBadge');

    const raffle = await api.scan(vol1, { checkpointId: f.cp.R, method: 'qr', token: f.token.A });
    expect(raffle.body.code).toBe('ACCEPTED');
    expect(raffle.body).not.toHaveProperty('hasBadge');
    expect(raffle.body).not.toHaveProperty('badgeLabel');
  });
});
