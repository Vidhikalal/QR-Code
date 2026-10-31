// SPEC F14 step 4 (v0.8.2): the organizers' schedule text. A line `9:00-10:00 | Title | Place` (end time and
// place optional; -, –, —, → or "to" between the times; 24-hour or 1:00 PM, kept as typed) is a time slot;
// other lines head the slots below them.

export interface ScheduleSlot {
  start: string;
  end: string | null;
  title: string;
  place: string | null;
}

export interface ScheduleSection {
  label: string | null;
  slots: ScheduleSlot[];
}

const TIME = '(?:[01]?\\d|2[0-3]):[0-5]\\d(?:\\s*[AaPp]\\.?[Mm]\\.?)?';
const SLOT = new RegExp(`^(${TIME})(?:\\s*(?:-|–|—|→|to)\\s*(${TIME}))?\\s*\\|(.*)$`);

function slot(line: string): ScheduleSlot | null {
  const m = SLOT.exec(line);
  if (!m) return null;
  const [title = '', ...rest] = (m[3] ?? '').split('|').map((s) => s.trim());
  const place = rest.join(' | ');
  return title ? { start: m[1] ?? '', end: m[2] ?? null, title, place: place || null } : null;
}

// Null when no line is a slot: the text is then shown as written, line breaks kept.
export function parseSchedule(text: string): ScheduleSection[] | null {
  const sections: ScheduleSection[] = [];
  let found = false;
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const s = slot(line);
    const last = sections.at(-1);
    if (s) {
      found = true;
      if (last) last.slots.push(s);
      else sections.push({ label: null, slots: [s] });
    } else if (last && last.label !== null && last.slots.length === 0) {
      last.label += `\n${line}`;
    } else {
      sections.push({ label: line, slots: [] });
    }
  }
  return found ? sections : null;
}
export type ScheduleCategory = 'hacking' | 'activities' | 'workshops' | 'food' | 'sponsors';
export interface TimelineSlot extends ScheduleSlot {
  startMinute: number;
  endMinute: number;
  lane: number;
  laneCount: number;
  category: ScheduleCategory;
  state: 'past' | 'current' | 'upcoming';
}
export interface TimelineDay {
  nowMinute: number | null;
  isToday: boolean;
  label: string | null;
  slots: TimelineSlot[];
  unscheduled: ScheduleSlot[];
  startMinute: number;
  endMinute: number;
}

function minutes(time: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)\s*([ap])\.?m\.?$/i.exec(time.trim())
    ?? /^(\d{1,2}):([0-5]\d)$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  if (match[3] ? hour < 1 || hour > 12 : hour > 23) return null;
  return (match[3] ? hour % 12 + (match[3].toLowerCase() === 'p' ? 12 : 0) : hour) * 60 + Number(match[2]);
}

// First match wins: Workshop/Talk/MLH Meetup; meals/snacks; Sponsor; hacking milestones;
// everything else is Activities. MLH Meetup is a workshop to match the official poster.
const CATEGORY_RULES: [RegExp, ScheduleCategory][] = [
  [/\b(workshop|talk|MLH\s+Meetup)\b/i, 'workshops'],
  [/\b(lunch|dinner|breakfast|snacks?)\b/i, 'food'],
  [/\bsponsor\b/i, 'sponsors'],
  [/\b(hacking\s+(begins|ends)|devpost|draft\s+due|demos|judging|quiet\s+rooms)\b/i, 'hacking'],
];

// Intl extracts civil time in the event zone; UTC below is only calendar-day arithmetic.
function civilTime(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value);
  return { year: part('year'), date: Date.UTC(part('year'), part('month') - 1, part('day')), minute: part('hour') * 60 + part('minute') };
}

function sectionDate(label: string | null, reference: { year: number; date: number }): number | null {
  const match = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i.exec(label ?? '');
  if (!match) return null;
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[1]!.slice(0, 3).toLowerCase());
  const day = Number(match[2]);
  const years = match[3] ? [Number(match[3])] : [reference.year - 1, reference.year, reference.year + 1];
  const candidates = years.map(year => Date.UTC(year, month, day)).filter(date => new Date(date).getUTCMonth() === month);
  return candidates.sort((a, b) => Math.abs(a - reference.date) - Math.abs(b - reference.date))[0] ?? null;
}

export function scheduleTimeline(sections: ScheduleSection[], now?: Date, timezone = 'UTC', eventStartsAt?: string): TimelineDay[] {
  const local = now && Number.isFinite(now.getTime()) ? civilTime(now, timezone) : null;
  const reference = eventStartsAt ? civilTime(new Date(eventStartsAt), timezone) : local;
  return sections.map(section => {
    const date = reference ? sectionDate(section.label, reference) : null;
    const relativeNow = local && date !== null ? (local.date - date) / 60_000 + local.minute : null;
    const slots: TimelineSlot[] = [];
    const unscheduled: ScheduleSlot[] = [];
    let seenAfternoon = false;
    for (const slot of section.slots) {
      const start = minutes(slot.start);
      if (start === null) { unscheduled.push({ ...slot }); continue; }
      const offset = start < 360 && seenAfternoon ? 1440 : 0;
      if (start >= 720) seenAfternoon = true;
      const startMinute = start + offset;
      const end = slot.end ? minutes(slot.end) : null;
      let endMinute = end === null ? startMinute + 30 : end + offset;
      if (endMinute < startMinute) endMinute += 1440;
      if (endMinute === startMinute) endMinute += 30;
      slots.push({ ...slot, startMinute, endMinute, lane: 0, laneCount: 1,
        state: relativeNow === null || relativeNow < startMinute ? 'upcoming' : relativeNow >= endMinute ? 'past' : 'current',
        category: CATEGORY_RULES.find(([rule]) => rule.test(slot.title))?.[1] ?? 'activities' });
    }
    slots.sort((a, b) => a.startMinute - b.startMinute);
    let group: TimelineSlot[] = [];
    let laneEnds: number[] = [];
    const finishGroup = () => { for (const slot of group) slot.laneCount = laneEnds.length; };
    for (const slot of slots) {
      if (laneEnds.length && laneEnds.every(end => end <= slot.startMinute)) {
        finishGroup(); group = []; laneEnds = [];
      }
      const available = laneEnds.findIndex(end => end <= slot.startMinute);
      slot.lane = available < 0 ? laneEnds.length : available;
      laneEnds[slot.lane] = slot.endMinute;
      group.push(slot);
    }
    finishGroup();
    const first = Math.min(...slots.map(s => s.startMinute));
    const last = Math.max(...slots.map(s => s.endMinute));
    return { label: section.label, slots, unscheduled,
      isToday: local !== null && date === local.date,
      nowMinute: relativeNow !== null && relativeNow >= first && relativeNow < last ? relativeNow : null,
      startMinute: slots.length ? Math.floor(Math.min(...slots.map(s => s.startMinute)) / 60) * 60 : 480,
      endMinute: slots.length ? Math.ceil(Math.max(...slots.map(s => s.endMinute)) / 60) * 60 : 1080 };
  });
}
