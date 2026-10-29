
import { Entrance } from '@/components/motion';
import { Card } from '@/components/ui/card';
import type { Metadata } from 'next';
import Link from 'next/link';
import { parseSchedule } from '@/lib/domain/schedule';
import { loadMyEvent, menuMetadata } from '../load';

export const metadata: Metadata = menuMetadata('Schedule');

// SPEC F14: the schedule organizers type on the admin Info page (plain text, rendered escaped). v0.8.2:
// `9:00-10:00 | Title | Place` lines show as time slots under the day lines above them.
export default async function SchedulePage() {
  const { me: m } = await loadMyEvent('/me/schedule');
  const sections = parseSchedule(m.event.schedule);
  return (
    <Entrance><main className="max-w-[480px] lg:pointer-fine:max-w-[760px]  m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
      <div className="flex items-center justify-between gap-[16px] min-h-[44px] pb-[4px] mb-[8px] [border-bottom-width:1px]

          [border-bottom-style:solid] [border-bottom-color:var(--line)]">
        <Link className="inline-flex items-center min-h-[44px] text-fg font-semibold no-underline [&:hover]:text-accent" href="/me">
          ← Menu
        </Link>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-[12px] tracking-[0.08em]

          uppercase">{m.event.name}</span>
      </div>
      <h1>Schedule</h1>
      {sections ? (
        sections.map((s, i) => (
          <div key={i} className="grid gap-[8px]">
            {/* A line heads the slots below it; one with none below (a closing note) is just text. */}
            {s.label && (s.slots.length > 0 ? <h2 className="m-[8px_0px_0px] text-link text-[15px] whitespace-pre-line">{s.label}</h2> : <p className="whitespace-pre-line [overflow-wrap:anywhere] leading-[1.7]">{s.label}</p>)}
            {s.slots.length > 0 && (
              <ol className="m-0 p-0 list-none grid gap-[8px]">
                {s.slots.map((t, j) => (
                  <li key={j} className="grid gap-[2px] p-[10px_14px] [border-width:1px] [border-style:solid]

          [border-top-color:color-mix(in_srgb,_var(--accent)_28%,_transparent)]

          [border-right-color:color-mix(in_srgb,_var(--accent)_28%,_transparent)]

          [border-bottom-color:color-mix(in_srgb,_var(--accent)_28%,_transparent)]

          [border-left-color:color-mix(in_srgb,_var(--accent)_28%,_transparent)] rounded-control

          [background:color-mix(in_srgb,_var(--accent)_6%,_var(--card))] shadow-panel [overflow-wrap:anywhere]">
                    <span className="text-accent text-[13px]">{t.end ? `${t.start} → ${t.end}` : t.start}</span>
                    <strong>{t.title}</strong>
                    {t.place && <span className="text-muted-foreground text-[13px]">{t.place}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))
      ) : (
        <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section >
          <p className="whitespace-pre-line [overflow-wrap:anywhere] leading-[1.7]">{m.event.schedule || 'The organizers haven’t posted the schedule yet.'}</p>
        </section></Card>
      )}
    </main></Entrance>
  );
}
