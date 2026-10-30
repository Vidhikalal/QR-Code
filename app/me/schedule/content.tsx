import { Card } from '@/components/ui/card';
import { parseSchedule } from '@/lib/domain/schedule';
import { ScheduleCalendar } from './calendar';

// Parse on the server; only calendar data and its clock context cross the client boundary.
export function ScheduleContent({ schedule, now, timezone, eventStartsAt }: {
  schedule: string; now: Date; timezone: string; eventStartsAt: string;
}) {
  const sections = parseSchedule(schedule);
  return sections ? (
    <ScheduleCalendar sections={sections} initialNow={now.toISOString()} timezone={timezone} eventStartsAt={eventStartsAt} />
  ) : (
    <Card className="[&>p]:m-0">
      <p className="copy whitespace-pre-line [overflow-wrap:anywhere] leading-[1.7]">{schedule || "The schedule isn't posted yet."}</p>
    </Card>
  );
}
