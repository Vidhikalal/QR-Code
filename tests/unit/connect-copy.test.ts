import { describe, expect, it } from 'vitest';
import { CONNECT_CODES, connectCopy } from '@/lib/connections/copy';

describe('Connect copy (PLAN §10.4)', () => {
  it('T-CONN-04 (copy): each result reads as the PLAN table says', () => {
    expect(connectCopy('PENDING', 'Sam')).toEqual({ ok: true, text: 'Sent! It counts once Sam taps your badge too.' });
    expect(connectCopy('MUTUAL', 'Sam')).toEqual({ ok: true, text: 'You’re connected with Sam.' });
    expect(connectCopy('ALREADY_PENDING', 'Sam').text).toBe('Waiting for Sam to tap your badge.');
    expect(connectCopy('ALREADY_MUTUAL', 'Sam').text).toBe('You’re already connected.');
    expect(connectCopy('SELF', null)).toEqual({ ok: false, text: 'That’s your own badge.' });
    expect(connectCopy('NOT_CHECKED_IN', null).text).toBe('Check in at the door first.');
    for (const c of ['TAG_UNASSIGNED', 'TAG_REPLACED', 'NOT_FOUND', 'WRONG_EVENT'] as const) expect(connectCopy(c, null).text).toBe('This badge can’t be connected.');
    for (const c of CONNECT_CODES) expect(connectCopy(c, 'x').text.length).toBeGreaterThan(0);
  });
});
