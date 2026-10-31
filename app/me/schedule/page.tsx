
import { BrandMark } from '@/components/brand-mark';
import { Entrance } from '@/components/motion';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ScheduleContent } from './content';
import { loadMyEvent, menuMetadata } from '../load';

export const metadata: Metadata = menuMetadata('Schedule');

// SPEC F14: organizers’ timed slots become a calendar; free text remains escaped text.
export default async function SchedulePage() {
  const { me: m, now } = await loadMyEvent('/me/schedule');
  return (
    <Entrance><main className="w-full max-w-[1400px]  m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
      <div className="flex items-center gap-[16px] min-h-[44px] mb-[8px]">
        <Link className="inline-flex shrink-0 items-center min-h-[44px] text-fg font-semibold no-underline [&:hover]:text-accent" href="/me">
          ← Menu
        </Link>
        <BrandMark name={m.event.name} className="max-w-[70%]" />
        <span aria-hidden="true" className="min-w-3 flex-1 h-px bg-[var(--edge)]" />
      </div>
      <h1>Schedule</h1>
      <ScheduleContent schedule={m.event.schedule} now={now} timezone={m.event.timezone} eventStartsAt={m.event.startsAt} />
    </main></Entrance>
  );
}
