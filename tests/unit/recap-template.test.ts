import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/domain/next-path';
import { DEFAULT_RECAP_MESSAGE, renderRecapEmail, validateRecapMessage, type RecapInput } from '@/lib/recap/template';

const base: RecapInput = {
  firstName: 'Ada',
  nickname: 'Ace',
  eventName: 'Hack Day',
  message: 'Hi {nickname} ({first_name})! {event}: {workshops} workshops, {activities} activities, {connections} connections, {activity_points}/{networking_points} pts.',
  stats: { workshops: 3, activities: 2, connections: 7, activityPoints: 45, networkingPoints: 9 },
  connectionsUrl: 'https://me.example.test/edit?next=/me/connections#KEY123',
  unlockPassword: 'open-sesame',
};

describe('recap template (PLAN §12.4)', () => {
  it('T-RECAP-04: every placeholder renders, in HTML and text', () => {
    const r = renderRecapEmail(base);
    const expected = 'Hi Ace (Ada)! Hack Day: 3 workshops, 2 activities, 7 connections, 45/9 pts.';
    expect(r.subject).toBe('Thanks for coming to Hack Day!');
    expect(r.text).toContain(expected);
    expect(r.html).toContain(expected);
    expect(r.html).toContain('href="https://me.example.test/edit?next=/me/connections#KEY123"');
    expect(r.text).toContain('https://me.example.test/edit?next=/me/connections#KEY123');
    expect(r.html).toContain('open-sesame');
    expect(r.text).toContain('open-sesame');
    expect(r.text).toMatch(/NFC Tools/);
    expect(r.inlineImages).toEqual([]);
  });

  it('T-RECAP-04: unknown placeholders are a validation error; 2001 chars too long; known ones pass', () => {
    expect(validateRecapMessage('Hi {nickname}, see {prize} and {Event}')).toEqual({ ok: false, unknown: ['{prize}', '{Event}'] });
    expect(validateRecapMessage('x'.repeat(2001))).toEqual({ ok: false, tooLong: true });
    expect(validateRecapMessage(base.message ?? "")).toEqual({ ok: true });
    expect(validateRecapMessage(DEFAULT_RECAP_MESSAGE)).toEqual({ ok: true });
  });

  it('T-RECAP-04: HTML in the message and in names is escaped; newlines become <br>', () => {
    const r = renderRecapEmail({ ...base, nickname: '<b>x</b>', message: '<script>alert(1)</script>\nThanks {nickname}' });
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<b>x</b>');
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;<br>Thanks &lt;b&gt;x&lt;/b&gt;');
    expect(r.text).toContain('<script>alert(1)</script>\nThanks <b>x</b>');
  });

  it('T-RECAP-04: no unlock section without a password; default message when none is set; nickname falls back to first name', () => {
    const r = renderRecapEmail({ ...base, unlockPassword: null, message: null, nickname: null });
    expect(r.text).not.toMatch(/Unlock your badge/);
    expect(r.html).not.toMatch(/Unlock your badge/);
    expect(r.text).toContain('Thanks for coming to Hack Day, Ada! You attended 3 workshops and made 7 connections.');
  });

  it('PLAN §12.4: safeNext allows only /me and /me/connections', () => {
    expect(safeNext('/me/connections')).toBe('/me/connections');
    expect(safeNext('/me')).toBe('/me');
    for (const bad of [null, '', 'https://evil.example', '//evil.example', '/me/../admin', '/me/connections?x=1', '/admin', '/me/']) {
      expect(safeNext(bad), String(bad)).toBe('/me');
    }
  });
});
