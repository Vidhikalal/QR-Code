import { describe, expect, it } from 'vitest';
import { badgeUrl, badgeWritable, formatUid, normalizeUid } from '@/lib/domain/badge';

describe('badge UIDs (SPEC §6.5)', () => {
  it('T-NFC-01: normalizes Chrome serial numbers and plain hex to lowercase hex', () => {
    expect(normalizeUid('04:A1:B2:C3:D4:E5:F6')).toBe('04a1b2c3d4e5f6');
    expect(normalizeUid(' 04a1b2c3 ')).toBe('04a1b2c3');
    expect(normalizeUid('04-a1-b2-c3')).toBe('04a1b2c3');
  });

  it('T-NFC-15: the tag payload is exactly ${BADGE_ORIGIN}/profile/<uid>?tap, and only https origins are written', () => {
    expect(badgeUrl('https://nfc.yvesdonato.com', '04a1b2c3d4e5f6')).toBe('https://nfc.yvesdonato.com/profile/04a1b2c3d4e5f6?tap');
    expect(badgeWritable('https://nfc.yvesdonato.com')).toBe(true);
    expect(badgeWritable('http://localhost:3000')).toBe(false);
    expect(badgeWritable('http://nfc.yvesdonato.com')).toBe(false);
    expect(formatUid('04a1b2c3')).toBe('04:A1:B2:C3');
  });

  it('T-NFC-01: rejects empty, too short, too long, odd-length and non-hex input without throwing', () => {
    for (const bad of ['', '04', '04:a1:b2', '04a1b2c3d', 'a'.repeat(22), 'zz:zz:zz:zz', "04a1b2c3';--", '٠٤a1b2c3']) {
      expect(normalizeUid(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
