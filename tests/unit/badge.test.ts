import { describe, expect, it } from 'vitest';
import {
  badgeUrl,
  badgeWritable,
  DISCORD_PATTERN,
  formatUid,
  LINKEDIN_PATTERN,
  linkNotice,
  normalizeDiscord,
  normalizeLinkedIn,
  normalizeUid,
  normalizeWebsite,
  WEBSITE_PATTERN,
} from '@/lib/domain/badge';
import { parseProfileInput } from '@/lib/domain/profile';

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

  it('T-NFC-25: normalizeDiscord takes a username with or without @, in any case; anything else is null, no throw', () => {
    expect(normalizeDiscord(' @Ada.Codes ')).toBe('ada.codes');
    expect(normalizeDiscord('ada_99')).toBe('ada_99');
    for (const bad of ['', '   ', '@', 'a', 'a'.repeat(33), 'ada#1234', 'ada codes', 'a..b', 'ada-codes', '@@ada', 'adä']) {
      expect(normalizeDiscord(bad), bad).toBeNull();
    }
    // The form's HTML pattern (anchored, v flag, as the browser runs it) agrees.
    const html = new RegExp(`^(?:${DISCORD_PATTERN})$`, 'v');
    for (const s of [' @Ada.Codes ', 'ada_99', '', '@', 'a', 'a'.repeat(33), 'ada#1234', 'ada codes', 'a..b', 'ada-codes', '@@ada', 'adä']) {
      expect(html.test(s), s).toBe(s !== '' && normalizeDiscord(s) !== null);
    }
  });

  it('T-NFC-25: normalizeWebsite takes an http(s) site, adding https:// when missing; anything else is null, no throw', () => {
    expect(normalizeWebsite(' ada.dev ')).toBe('https://ada.dev/');
    expect(normalizeWebsite('http://ada.dev/projects?x=1')).toBe('http://ada.dev/projects?x=1');
    expect(normalizeWebsite('HTTPS://Ada.Dev/Blog')).toBe('https://ada.dev/Blog');
    expect(normalizeWebsite('ada.dev:8443/x')).toBe('https://ada.dev:8443/x'); // a port isn't a scheme
    for (const bad of [
      '',
      '   ',
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'mailto:a@ada.dev',
      'ftp://ada.dev',
      'https://user:pw@ada.dev',
      'localhost',
      'http://localhost:3000',
      'https://ada .dev',
      `ada.dev/${'a'.repeat(300)}`, // over 300 once normalized
    ]) {
      expect(normalizeWebsite(bad), bad).toBeNull();
    }
    // The form's HTML pattern catches the usual typos before the form is sent (a refusal would lose what was typed);
    // the server rule stays the authority for the rest.
    const html = new RegExp(`^(?:${WEBSITE_PATTERN})$`, 'v');
    // The field's maxLength is 200 typed characters; https:// and a trailing / are added on top.
    for (const ok of ['ada.dev', 'https://ada.dev', 'HTTP://Ada.Dev/Blog?x=1#top', 'github.com/ada', 'ada.dev:8443/x', `ada.dev/${'a'.repeat(192)}`]) {
      expect(html.test(ok), ok).toBe(true);
      expect(normalizeWebsite(ok), ok).not.toBeNull();
    }
    for (const bad of ['ada', 'localhost:3000', 'ada dev.com', 'javascript:alert(1)', 'ftp://ada.dev', 'mailto:a@ada.dev', 'https://user:pw@ada.dev']) {
      expect(html.test(bad), bad).toBe(false);
      expect(normalizeWebsite(bad), bad).toBeNull();
    }
  });

  it('T-NFC-25: the LinkedIn field’s HTML pattern refuses in the browser what normalizeLinkedIn would refuse', () => {
    const html = new RegExp(`^(?:${LINKEDIN_PATTERN})$`, 'v');
    for (const ok of [' linkedin.com/in/ada-l ', 'WWW.LinkedIn.com/in/ada-l/', 'http://ca.linkedin.com/in/ada-l?trk=x#y', 'linkedin.com/in/josé']) {
      expect(html.test(ok), ok).toBe(true);
      expect(normalizeLinkedIn(ok), ok).not.toBeNull();
    }
    for (const bad of [
      'linkedin.com/company/x',
      'linkedin.com/in/',
      'linkedin.com/in/a/b',
      'javascript:alert(1)',
      'https://evil.com/linkedin.com/in/x',
      'https://linkedin.com.evil.com/in/x',
      'https://user:pw@linkedin.com/in/x',
      'https://linkedin.com:8443/in/x',
      'ftp://linkedin.com/in/x',
      'linkedin.com/in/ada.codes', // a dot or "!" in the handle: the server's rule refuses it
      'linkedin.com/in/ada!',
    ]) {
      expect(html.test(bad), bad).toBe(false);
      expect(normalizeLinkedIn(bad), bad).toBeNull();
    }
  });

  it('T-NFC-25: every stored value passes its field’s pattern (it is the field’s default; a refusal would block the form)', () => {
    const passes = (pattern: string, v: string) => new RegExp(`^(?:${pattern})$`, 'v').test(v);
    for (const typed of ['ada.dev', 'café.dev/é?x=1#f', 'ada.dev:8443/x', 'HTTP://Ada.Dev/Blog?x=1#top', 'github.com/ada']) {
      const stored = normalizeWebsite(typed) ?? '';
      expect(passes(WEBSITE_PATTERN, stored), stored).toBe(true);
    }
    for (const typed of ['linkedin.com/in/ada-l', 'linkedin.com/in/josé', 'ca.linkedin.com/in/x?trk=1']) {
      const stored = normalizeLinkedIn(typed) ?? '';
      expect(passes(LINKEDIN_PATTERN, stored), stored).toBe(true);
    }
    expect(passes(DISCORD_PATTERN, normalizeDiscord('@Ada.Codes') ?? '')).toBe(true);
  });

  it('T-NFC-25: parseProfileInput: blank clears Discord and website, an invalid one names its field', () => {
    expect(parseProfileInput({ discord: '@Ada.Codes', website: 'ada.dev' }, { requireEmergency: false })).toEqual({
      ok: true,
      value: { discordUsername: 'ada.codes', websiteUrl: 'https://ada.dev/' },
    });
    expect(parseProfileInput({ discord: ' ', website: '' }, { requireEmergency: false })).toEqual({
      ok: true,
      value: { discordUsername: '', websiteUrl: '' },
    });
    expect(parseProfileInput({}, { requireEmergency: false })).toEqual({ ok: true, value: {} });
    expect(parseProfileInput({ discord: 'ada#1234' }, { requireEmergency: false })).toEqual({ ok: false, field: 'discord' });
    expect(parseProfileInput({ website: 'javascript:alert(1)' }, { requireEmergency: false })).toEqual({ ok: false, field: 'website' });
  });

  it('T-NFC-28: linkNotice words each link_badge outcome for staff, with the badge UID and the person’s name', () => {
    expect(linkNotice('LINKED', '04a1b2c3', 'Ada Fixture')).toEqual({ tone: 'ok', text: '✓ Badge 04:A1:B2:C3 linked to Ada Fixture.' });
    expect(linkNotice('LINKED', '04a1b2c3', 'Ada Fixture', 'written').text).toBe('✓ Badge 04:A1:B2:C3 linked to Ada Fixture. Its profile link is on the badge.');
    expect(linkNotice('LINKED', '04a1b2c3', 'Ada Fixture', 'failed').text).toBe("✓ Badge 04:A1:B2:C3 linked to Ada Fixture. Couldn't write its profile link: hold the badge still and tap Link badge again.");
    expect(linkNotice('BADGE_TAKEN', '04a1b2c3', 'Ada Fixture', 'written')).toEqual(linkNotice('BADGE_TAKEN', '04a1b2c3', 'Ada Fixture'));
    expect(linkNotice('BADGE_TAKEN', '04a1b2c3', 'Ada Fixture')).toEqual({
      tone: 'bad',
      text: '✕ Badge 04:A1:B2:C3 is linked to someone else. Ask an organizer to move it.',
    });
    expect(linkNotice('NOT_FOUND', '04a1b2c3', 'Ada Fixture')).toEqual({ tone: 'bad', text: '✕ Ada Fixture isn’t in this event any more.' });
    expect(linkNotice(undefined, '04a1b2c3', 'Ada Fixture')).toEqual({ tone: 'bad', text: '✕ Badge not linked. Try again.' });
  });
});
