import { describe, expect, it } from 'vitest';
import { renderProfileLinkEmail } from '@/lib/email/templates/profile-link';

const base = { firstName: 'Ada', eventName: 'Hack Day 2026', editUrl: 'https://me.example.com/edit#Ab3_-xYz0123456789abcdefGHIJKLMNopqrstuvwxy' };

describe('profile link email (PLAN §12.2)', () => {
  it('T-MAIL-07 (v2): subject, greeting, the edit link in both parts, and the ignore line; no images', () => {
    const m = renderProfileLinkEmail(base);
    expect(m.subject).toBe('Your Hack Day 2026 profile link');
    for (const part of [m.html, m.text]) {
      expect(part).toContain('Ada');
      expect(part).toContain(base.editUrl);
      expect(part).toContain("If you didn't ask for this, you can ignore it.");
    }
    expect(m.inlineImages).toEqual([]);
  });

  it('T-MAIL-08 (v2): interpolated values are escaped', () => {
    const m = renderProfileLinkEmail({ ...base, firstName: '<b>x</b>', eventName: 'A & "B"' });
    expect(m.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(m.html).not.toContain('<b>x</b>');
    expect(m.html).toContain('A &amp; &quot;B&quot;');
  });

  it('T-MAIL-09 (v2): the HTML stays well under the clipping threshold', () => {
    expect(Buffer.byteLength(renderProfileLinkEmail(base).html)).toBeLessThan(60 * 1024);
  });
});
