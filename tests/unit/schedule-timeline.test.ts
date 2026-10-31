import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSchedule, scheduleTimeline, type ScheduleSlot } from '@/lib/domain/schedule';

const official = readFileSync(new URL('../fixtures/schedule/official.txt', import.meta.url), 'utf8');
const makeSlot = (start: string, end: string | null = null, title = 'Activity'): ScheduleSlot => ({ start, end, title, place: null });

describe('scheduleTimeline', () => {
  it('T-ME-11: real poster has 23 Saturday and 6 Sunday slots, including the same night past midnight', () => {
    const days = scheduleTimeline(parseSchedule(official)!);
    expect(days.map(d => d.slots.length)).toEqual([23, 6]);
    expect(days.map(d => [d.startMinute, d.endMinute])).toEqual([[540, 1560], [480, 960]]);
    const saturday = days[0]!;
    expect(saturday.slots.find(s => s.title === 'Spin the Wheel')).toMatchObject({ startMinute: 1320, endMinute: 1440 });
    expect(saturday.slots.find(s => s.title === 'Magic: The Gathering')).toMatchObject({ startMinute: 1440, endMinute: 1560 });
    expect(saturday.slots.find(s => s.title === 'Opening Ceremony')).toMatchObject({ startMinute: 660, endMinute: 690 });
  });

  it('T-ME-11: every pair of overlapping poster slots uses different lanes, with a shared group width', () => {
    for (const day of scheduleTimeline(parseSchedule(official)!)) {
      for (const a of day.slots) for (const b of day.slots) {
        expect(a.lane).toBeLessThan(a.laneCount);
        if (a !== b && a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
          expect(a.lane).not.toBe(b.lane);
          expect(a.laneCount).toBe(b.laneCount);
        }
      }
    }
    const [day] = scheduleTimeline([{ label: 'Day', slots: [makeSlot('9:00', '10:00'), makeSlot('9:30', '10:30'), makeSlot('10:30', '11:00')] }]);
    expect(day!.slots.map(s => [s.lane, s.laneCount])).toEqual([[0, 2], [1, 2], [0, 1]]);
  });

  it('T-ME-11: title categories match the poster, including MLH Meetup', () => {
    const days = scheduleTimeline(parseSchedule(official)!);
    const category = (title: string) => days.flatMap(d => d.slots).find(s => s.title.startsWith(title))?.category;
    for (const title of ['Hacking Begins', 'Hacking Ends', 'Devpost', 'Quiet Rooms', 'Demos']) expect(category(title)).toBe('hacking');
    for (const title of ['Lunch', 'Dinner', 'Breakfast', 'Snack Cart', 'Late-Night Snacks']) expect(category(title)).toBe('food');
    for (const title of ['Workshop', 'Talk', 'MLH Meetup']) expect(category(title)).toBe('workshops');
    expect(category('Sponsor')).toBe('sponsors');
    for (const title of ['Check-in', 'Opening', 'Photo Booth', 'Team formation', 'Caricatures', 'Fitness', 'Spin', 'Karaoke', 'Magic']) expect(category(title)).toBe('activities');
  });

  it('T-ME-11: typed 24-hour, AM/PM, compact and dotted times; overnight rollover and rounding', () => {
    const slots = [makeSlot('9:00', '10:01'), makeSlot('9:00 AM'), makeSlot('9:30am'), makeSlot('2:15 p.m.'), makeSlot('23:30', '00:15'), makeSlot('1:00', '02:15')];
    const [day] = scheduleTimeline([{ label: 'Day', slots }]);
    expect(day!.slots.map(s => [s.startMinute, s.endMinute])).toEqual([[540, 601], [540, 570], [570, 600], [855, 885], [1410, 1455], [1500, 1575]]);
    expect([day!.startMinute, day!.endMinute]).toEqual([540, 1620]);
    expect(scheduleTimeline([{ label: null, slots: [makeSlot('2:00 AM')] }])[0]!.slots[0]!.startMinute).toBe(120);
  });

  it('T-ME-11: malformed times are preserved outside the grid, bad ends use 30 minutes, empty days never throw', () => {
    const [day, empty] = scheduleTimeline([{ label: 'Day', slots: [makeSlot('broken'), makeSlot('25:00'), makeSlot('13:00 PM'), makeSlot('9:60'), makeSlot('9:00', 'oops')] }, { label: 'Empty', slots: [] }]);
    expect(day!.unscheduled).toHaveLength(4);
    expect(day!.slots[0]).toMatchObject({ startMinute: 540, endMinute: 570 });
    expect(empty).toMatchObject({ slots: [], unscheduled: [], startMinute: 480, endMinute: 1080 });
    expect(scheduleTimeline([])).toEqual([]);
  });
});

describe('live schedule state', () => {
  const sections = parseSchedule(official)!;
  const at = (instant: string, zone = 'America/Toronto') => scheduleTimeline(sections, new Date(instant), zone, '2026-11-07T14:00:00Z');
  it('T-ME-11: upcoming, current and past at the exact start/end boundaries in the event timezone', () => {
    expect(at('2026-11-07T13:59:00Z')[0]!.slots[0]!.state).toBe('upcoming');
    expect(at('2026-11-07T14:00:00Z')[0]!.slots[0]!.state).toBe('current');
    expect(at('2026-11-07T15:45:00Z')[0]!.slots[0]!.state).toBe('past');
    const days = at('2026-11-07T19:40:00Z');
    expect(days[0]!.nowMinute).toBe(880);
    expect(days[1]!.nowMinute).toBeNull();
    expect(days[0]!.slots.find(s => s.title.startsWith('Workshop: Google'))!.state).toBe('current');
    expect(days[0]!.slots.find(s => s.title === 'Dinner')!.state).toBe('upcoming');
    expect(days[0]!.slots.find(s => s.title === 'Lunch')!.state).toBe('past');
  });
  it('T-ME-11: after midnight belongs to Saturday night until its last event ends', () => {
    const days = at('2026-11-08T06:00:00Z');
    expect(days[0]!.nowMinute).toBe(1500);
    expect(days[1]!.nowMinute).toBeNull();
    expect(days[0]!.slots.find(s => s.title === 'Magic: The Gathering')!.state).toBe('current');
    expect(days[0]!.slots.find(s => s.title === 'Spin the Wheel')!.state).toBe('past');
    expect(at('2026-11-08T07:00:00Z').every(d => d.nowMinute === null)).toBe(true);
    expect(at('2026-11-08T12:00:00Z')[1]!.isToday).toBe(true);
  });
  it('T-ME-11: civil dates and times use the supplied timezone even when UTC is the previous day', () => {
    expect(at('2026-11-07T23:40:00Z', 'Asia/Tokyo')[1]!.nowMinute).toBe(520);
    expect(at('2026-11-07T05:40:00Z', 'Asia/Tokyo')[0]!.nowMinute).toBe(880);
  });
  it('T-ME-11: no line outside the event, in another year, or for an undated heading', () => {
    expect(at('2026-11-06T19:40:00Z').every(d => d.nowMinute === null)).toBe(true);
    expect(at('2027-11-07T19:40:00Z').every(d => d.nowMinute === null)).toBe(true);
    expect(at('2026-11-09T19:40:00Z').flatMap(d => d.slots).every(s => s.state === 'past')).toBe(true);
    expect(scheduleTimeline([{ label: 'Day', slots: [makeSlot('9:00')] }], new Date('2026-11-07T14:00:00Z'), 'America/Toronto')[0]!.nowMinute).toBeNull();
  });
});
