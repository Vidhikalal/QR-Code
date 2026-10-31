'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useHoverDetails } from '@/components/ui/hover-details';
import { scheduleTimeline, type ScheduleCategory, type ScheduleSection } from '@/lib/domain/schedule';

const categories: { id: ScheduleCategory; label: string; colour: string; classes: string }[] = [
  { id: 'hacking', label: 'Hacking', colour: '#b91c1c', classes: 'bg-[#b91c1c] text-white border-transparent' },
  { id: 'activities', label: 'Activities', colour: '#1d4ed8', classes: 'bg-[#1d4ed8] text-white border-transparent' },
  { id: 'workshops', label: 'Workshops', colour: '#fbbf24', classes: 'bg-[#fbbf24] text-[#1a1205] border-transparent' },
  { id: 'food', label: 'Food', colour: '#34d399', classes: 'bg-[#0b3029] text-[#e8f2ff] border-[#34d399]' },
  { id: 'sponsors', label: 'Sponsors', colour: '#1e3a8a', classes: 'bg-[#1e3a8a] text-white border-[#93c5fd]' },
];
const HOUR_HEIGHT = 64;
const TIME_COLUMN = 64;
const position = 'top-[calc((var(--minute)-var(--range-start))*var(--hour-height)/60)]';
const focus = 'focus-visible:outline-2 focus-visible:outline-fg focus-visible:outline-offset-2';
const details = 'mt-1 text-[11px]';
function dayHeading(label: string | null, index: number) {
  const [line = '', ...notes] = (label ?? '').split('\n');
  const match = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*(.*)$/i.exec(line);
  const weekday = match?.[1]?.slice(0, 3) ?? '';
  const date = match?.[2] || line || `Day ${index + 1}`;
  return { weekday, date, notes, button: [weekday, date].filter(Boolean).join(' ') };
}
function hourLabel(minute: number) {
  const hour = Math.floor(minute / 60) % 24;
  return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
}
function CalendarScroll({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setOverflowing(element.scrollWidth > element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <>
    {overflowing && <p className="mt-0 mb-2 text-xs text-muted-foreground md:hidden">Scroll across for overlapping events →</p>}
    <div ref={ref} className={`max-w-full overflow-auto border-b border-line ${focus}`} tabIndex={0} role="region" aria-label={label}>{children}</div>
  </>;
}

export function ScheduleCalendar({ sections, initialNow, timezone, eventStartsAt }: { sections: ScheduleSection[]; initialNow: string; timezone: string; eventStartsAt: string }) {
  const { bind, overlay } = useHoverDetails();
  const [now, setNow] = useState(() => new Date(initialNow));
  useEffect(() => {
    const tick = () => setNow(new Date());
    const initial = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, []);
  const days = scheduleTimeline(sections, now, timezone, eventStartsAt);
  const liveDay = days.findIndex(day => day.nowMinute !== null);
  const activeDay = liveDay >= 0 ? liveDay : days.findIndex(day => day.isToday);
  // A manual choice lasts until the current event day changes (including its overnight tail).
  const [choice, setChoice] = useState<{ index: number; activeDay: number } | null>(null);
  const selected = choice?.activeDay === activeDay ? choice.index : Math.max(0, activeDay);
  const headings = days.map((day, i) => dayHeading(day.label, i));
  const populated = days.filter(d => d.slots.length);
  const start = Math.min(...populated.map(d => d.startMinute));
  const end = Math.max(...populated.map(d => d.endMinute));
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start + i * 60);
  const nowLabel = `now ${new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(now)}`;
  return <div className="min-w-0" style={{ '--hour-height': `${HOUR_HEIGHT}px`, '--time-column': `${TIME_COLUMN}px` } as CSSProperties}>
    <div className="mb-4 flex flex-wrap gap-2 md:hidden" aria-label="Schedule day">
      {headings.map((heading, i) => days[i]!.slots.length > 0 && <button key={i} type="button" aria-pressed={selected === i} onClick={() => setChoice({ index: i, activeDay })}
        className={`min-h-11 cursor-pointer rounded-md border border-field bg-card px-4 py-2 font-[inherit] text-fg aria-pressed:border-accent aria-pressed:bg-raised aria-pressed:text-accent ${focus}`}>{heading.button}</button>)}
    </div>
    <div className="grid gap-4 md:grid-cols-2 md:items-start">
      {days.map((day, i) => {
        const heading = headings[i]!;
        if (!day.slots.length && !day.unscheduled.length) return <p key={i} className="whitespace-pre-line [overflow-wrap:anywhere]">{day.label}</p>;
        const lanes = Math.max(1, ...day.slots.map(s => s.laneCount));
        return <section key={i} className={`min-w-0 md:block ${selected === i ? 'block' : 'hidden'}`} aria-labelledby={`schedule-day-${i}`}>
          <h2 id={`schedule-day-${i}`} className="mt-0 mb-3 flex min-h-16 flex-col justify-center gap-0.5 md:ml-[var(--time-column)]">
            {heading.weekday && <span className="text-[13px] tracking-[.12em] text-muted-foreground uppercase">{heading.weekday}</span>}<strong className="text-[28px] leading-[1.2] uppercase">{heading.date}</strong>
          </h2>
          {heading.notes.map((note, n) => <p key={n} className="whitespace-pre-line [overflow-wrap:anywhere]">{note}</p>)}
          {day.unscheduled.map((slot, n) => <p key={n}>{slot.start} · {slot.title}{slot.place && ` · ${slot.place}`}</p>)}
          {day.slots.length > 0 && <CalendarScroll label={`${heading.button} calendar`}>
            {/* Share the desktop origin so hours align, but stop each grid at its own end. */}
            <div className="relative mt-2 h-[calc((var(--range-end)-var(--range-start))*var(--hour-height)/60+24px)] [--range-end:var(--day-end)] [--range-start:var(--day-start)] md:[--range-start:var(--common-start)]"
              style={{ '--day-start': day.startMinute, '--day-end': day.endMinute, '--common-start': start, minWidth: TIME_COLUMN + lanes * 120 } as CSSProperties}>
              <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                <div className="absolute -top-2 bottom-0 left-0 w-[var(--time-column)] border-r border-line bg-card/30 [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]" />
                {hours.filter(hour => hour <= day.endMinute).map(hour => <div key={hour} className={`absolute right-0 left-0 h-px ${position} ${hour < day.startMinute ? 'hidden md:block' : ''}`} style={{ '--minute': hour } as CSSProperties}>
                  <span className="absolute right-0 left-[var(--time-column)] h-px bg-line" />
                  <span className="absolute top-1/2 left-0 w-[var(--time-column)] -translate-y-1/2 text-center text-[13px] leading-5 text-muted-foreground tabular-nums">{hourLabel(hour)}</span>
                </div>)}
              </div>
              <ol className="absolute inset-[0_0_24px_var(--time-column)] m-0 list-none p-0" aria-label={day.label ?? heading.button}>
                {day.slots.map((slot, j) => {
                  const [title = '', ...subtitle] = slot.title.split(' — ');
                  const when = `${slot.start}${slot.end ? ` to ${slot.end}` : ''}${slot.place ? ` · ${slot.place}` : ''}`;
                  const category = categories.find(c => c.id === slot.category)!;
                  const duration = slot.endMinute - slot.startMinute;
                  const short = duration < 60 || (duration < 90 && slot.laneCount > 2);
                  const colour = slot.state === 'past' ? 'bg-[#222936] text-[#8fa0c4] border-transparent border-l-[var(--category)]' : category.classes;
                  return <li key={j} tabIndex={0} data-state={slot.state}
                    {...bind(<><strong className="block">{title}</strong>{subtitle.length > 0 && <span className="mt-1 block">{subtitle.join(' — ')}</span>}<span className="mt-1 block text-muted-foreground">{when}</span><span className="mt-2 flex items-center gap-2"><span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: category.colour }} />{category.label}</span></>)}
                    className={`group absolute overflow-hidden rounded-md border px-1.5 py-1 text-xs leading-[1.25] [overflow-wrap:anywhere] hover:outline-2 hover:outline-fg/70 hover:outline-offset-1 ${position} ${focus} ${colour} ${slot.state === 'current' ? 'ring-1 ring-accent/70' : ''}`}
                    style={{ '--minute': slot.startMinute, '--category': category.colour,
                      height: (slot.endMinute - slot.startMinute) * HOUR_HEIGHT / 60 - 2,
                      left: `${slot.lane / slot.laneCount * 100}%`, width: `calc(${100 / slot.laneCount}% - 2px)` } as CSSProperties}>
                    <span className="sr-only">{category.label}. {slot.state === 'current' ? 'In progress' : slot.state}. </span>
                    <strong className={`font-mono font-bold ${slot.endMinute - slot.startMinute <= 30 ? 'block truncate' : 'line-clamp-2'}`}>{title}</strong>
                    {subtitle.length > 0 && <span className={`${details} ${short ? 'sr-only' : 'line-clamp-1'}`}>{subtitle.join(' — ')}</span>}
                    <span className={`${details} ${short ? 'sr-only' : 'line-clamp-2'}`}>{when}</span>
                  </li>;
                })}
              </ol>
              {day.nowMinute !== null && <div data-testid="schedule-now" className={`pointer-events-none absolute right-0 left-0 z-10 h-0.5 text-[#f87171] ${position}`} style={{ '--minute': day.nowMinute } as CSSProperties}>
                <span className="absolute right-0 left-[var(--time-column)] h-0.5 bg-[#f87171]" />
                <span aria-hidden="true" className="absolute -top-[3px] left-[calc(var(--time-column)_-_4px)] size-2 rounded-full bg-[#f87171]" />
                <span className="absolute -top-1 left-0 -translate-y-full whitespace-nowrap rounded-sm bg-bg px-1 text-[11px] leading-4">{nowLabel}</span>
              </div>}
            </div>
          </CalendarScroll>}
        </section>;
      })}
    </div>
    {overlay}
    <ul className="mt-6 mb-0 flex list-none flex-wrap gap-x-6 gap-y-3 p-0 text-xs" aria-label="Event categories">
      {categories.map(c => <li key={c.id} className="flex items-center gap-2"><span aria-hidden="true" className={`size-4 rounded-[3px] border ${c.classes}`} />{c.label}</li>)}
    </ul>
  </div>;
}
