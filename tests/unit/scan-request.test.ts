import { describe, expect, it } from 'vitest';
import { scanRequestSchema } from '@/lib/scan/schema';

const base = {
  checkpointId: '0b8b4e0e-9a1c-4c5e-8a55-4b8f3e0d6c11',
  clientScanId: '3f2b7a9e-1c4d-4e8f-9a0b-2c3d4e5f6a7b',
  clientScannedAt: '2026-10-03T13:00:00.000Z',
};
const token = 'Ab3_-xYz0123456789abcdefGHIJKLMN';
const ok = (v: unknown) => scanRequestSchema.safeParse(v).success;

describe('POST /api/scan body (SPEC §9.1)', () => {
  it('T-SCAN-18: qr needs a token and no participantId; manual needs a participantId and no token', () => {
    expect(ok({ ...base, method: 'qr', token })).toBe(true);
    expect(ok({ ...base, method: 'manual', participantId: base.checkpointId })).toBe(true);
    expect(ok({ ...base, method: 'qr' })).toBe(false);
    expect(ok({ ...base, method: 'manual' })).toBe(false);
    expect(ok({ ...base, method: 'qr', token, participantId: base.checkpointId })).toBe(false);
    expect(ok({ ...base, method: 'manual', participantId: base.checkpointId, token })).toBe(false);
  });

  it('T-SCAN-20: rejects a malformed token, a non-v4 clientScanId, a bad timestamp and unknown keys', () => {
    expect(ok({ ...base, method: 'qr', token: `${token}x` })).toBe(false);
    expect(ok({ ...base, method: 'qr', token: token.replace('A', '+') })).toBe(false);
    expect(ok({ ...base, method: 'qr', token, clientScanId: '3f2b7a9e-1c4d-1e8f-9a0b-2c3d4e5f6a7b' })).toBe(false);
    expect(ok({ ...base, method: 'qr', token, clientScannedAt: 'yesterday' })).toBe(false);
    expect(ok({ ...base, method: 'qr', token, extra: 1 })).toBe(false);
    expect(ok({ ...base, method: 'nfc', token })).toBe(false);
  });

  it('T-NFC-02: nfc needs a normalized badgeUid and nothing else; qr and manual reject badgeUid', () => {
    const badgeUid = '04a1b2c3d4e5f6';
    expect(ok({ ...base, method: 'nfc', badgeUid })).toBe(true);
    expect(ok({ ...base, method: 'nfc' })).toBe(false);
    expect(ok({ ...base, method: 'nfc', badgeUid: '04:A1:B2:C3:D4:E5:F6' })).toBe(false);
    expect(ok({ ...base, method: 'nfc', badgeUid: '04a1b' })).toBe(false);
    expect(ok({ ...base, method: 'nfc', badgeUid, token })).toBe(false);
    expect(ok({ ...base, method: 'nfc', badgeUid, participantId: base.checkpointId })).toBe(false);
    expect(ok({ ...base, method: 'qr', token, badgeUid })).toBe(false);
    expect(ok({ ...base, method: 'manual', participantId: base.checkpointId, badgeUid })).toBe(false);
  });
});
