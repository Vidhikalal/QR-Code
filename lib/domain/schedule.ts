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
