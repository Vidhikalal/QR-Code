import { describe, expect, it } from 'vitest';
import { parseSchedule } from '@/lib/domain/schedule';

describe('parseSchedule (SPEC F14 step 4, v0.8.2)', () => {
  it('T-ME-08: slot lines become time blocks under the day lines above them', () => {
    const text = [
      'Saturday, Nov 7',
      '9:00-10:00 | Check-in & breakfast | Main lobby',
      ' 10:00 → 10:30 |  Opening ceremony ',
      '',
      '12:00 | Hacking starts',
      'Sunday, Nov 8',
      '23:30 – 0:15 | Midnight snack | Cafeteria | Floor 2',
    ].join('\n');
    expect(parseSchedule(text)).toEqual([
      {
        label: 'Saturday, Nov 7',
        slots: [
          { start: '9:00', end: '10:00', title: 'Check-in & breakfast', place: 'Main lobby' },
          { start: '10:00', end: '10:30', title: 'Opening ceremony', place: null },
          { start: '12:00', end: null, title: 'Hacking starts', place: null },
        ],
      },
      { label: 'Sunday, Nov 8', slots: [{ start: '23:30', end: '0:15', title: 'Midnight snack', place: 'Cafeteria | Floor 2' }] },
    ]);
  });

  it('T-ME-08: slots before any day line, and day lines in a row, keep their order', () => {
    expect(parseSchedule('9:00 to 9:30 | Doors\nSat\nnotes\n10:00-11:00 | Talk | B204\nBring a charger')).toEqual([
      { label: null, slots: [{ start: '9:00', end: '9:30', title: 'Doors', place: null }] },
      { label: 'Sat\nnotes', slots: [{ start: '10:00', end: '11:00', title: 'Talk', place: 'B204' }] },
      { label: 'Bring a charger', slots: [] },
    ]);
  });

  it('T-ME-08: 12-hour times are slots too, kept as typed', () => {
    expect(parseSchedule('Saturday\n1:00 PM - 2:00 PM | Lunch | Cafeteria\n9:30am | Doors\n2:15 p.m. to 3:00 p.m. | Talk')).toEqual([
      {
        label: 'Saturday',
        slots: [
          { start: '1:00 PM', end: '2:00 PM', title: 'Lunch', place: 'Cafeteria' },
          { start: '9:30am', end: null, title: 'Doors', place: null },
          { start: '2:15 p.m.', end: '3:00 p.m.', title: 'Talk', place: null },
        ],
      },
    ]);
  });

  it('T-ME-08: free text without a slot line is null (shown as written); bad times and blank titles are not slots', () => {
    for (const text of ['', 'Sat 9:00  Doors\nSat 12:00  Lunch', '25:00-26:00 | Late', '9:60 | Odd', '9:00 |', '9:00 | | Room', '9:00 Lunch']) {
      expect(parseSchedule(text), JSON.stringify(text)).toBeNull();
    }
    expect(parseSchedule('x'.repeat(6000))).toBeNull(); // no throw on long input
  });
});
