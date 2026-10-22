import { describe, expect, it } from 'vitest';
import { badgeUrl, badgeWritable, formatUid, normalizeLinkedIn, normalizeUid } from '@/lib/domain/badge';

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

  it('T-NFC-19: normalizeLinkedIn accepts the usual ways people paste their profile and returns one https form', () => {
    for (const ok of [
      'linkedin.com/in/ada-l',
      'www.linkedin.com/in/ada-l/',
      'http://linkedin.com/in/ada-l',
      ' https://www.linkedin.com/in/ada-l?trk=public#x ',
      'HTTPS://CA.LINKEDIN.COM/in/ada-l',
    ]) {
      expect(normalizeLinkedIn(ok), ok).toBe('https://www.linkedin.com/in/ada-l');
    }
    expect(normalizeLinkedIn('linkedin.com/in/zoë')).toBe('https://www.linkedin.com/in/zo%C3%AB');
  });

  it('T-NFC-19: normalizeLinkedIn rejects other pages, other hosts and scripts without throwing', () => {
    for (const bad of [
      '',
      '   ',
      'linkedin.com/company/x',
      'linkedin.com/in/',
      'linkedin.com/in/a/b',
      'javascript:alert(1)',
      'https://evil.com/linkedin.com/in/x',
      'https://linkedin.com.evil.com/in/x',
      'https://user:pw@linkedin.com/in/x',
      'https://linkedin.com:8443/in/x',
      'ftp://linkedin.com/in/x',
      `linkedin.com/in/${'a'.repeat(200)}`,
    ]) {
      expect(normalizeLinkedIn(bad), bad).toBeNull();
    }
  });
});
