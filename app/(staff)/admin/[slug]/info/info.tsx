'use client';

import { Alert } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { useCallback, useState } from 'react';
import { toLocalInput, zonedToUtc } from '@/lib/domain/event-time';
import { adminUrl, errorText, useApi, useLoad } from '../api';

interface EventInfo {
  schedule: string;
  emergencyInfo: string;
  /** v0.9 (F13): an instant from the API; edited as a datetime-local in the event timezone. */
  rsvpDeadline: string | null;
  timezone: string;
}

// SPEC §11 Info (v0.6): plain text hackers see in their menu (F14). Line breaks are kept; nothing is HTML.
export function Info({ slug }: { slug: string }) {
  const api = useApi();
  const [info, setInfo] = useState<EventInfo | null>(null);
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<EventInfo>(adminUrl(slug, '/event'));
    if (r.ok) {
      setInfo({ schedule: r.data.schedule, emergencyInfo: r.data.emergencyInfo, rsvpDeadline: r.data.rsvpDeadline, timezone: r.data.timezone });
      setDeadline(r.data.rsvpDeadline ? toLocalInput(r.data.rsvpDeadline, r.data.timezone) : '');
    } else setError(errorText(r));
  }, [api, slug]);

  useLoad(load);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!info) return;
    setBusy(true);
    setMessage(null);
    const body = { schedule: info.schedule, emergencyInfo: info.emergencyInfo, rsvpDeadline: deadline ? zonedToUtc(deadline, info.timezone) : null };
    const r = await api<EventInfo>(adminUrl(slug, '/event'), { method: 'PATCH', body });
    setBusy(false);
    if (r.ok) {
      setError(null);
      setMessage('✓ Saved. Hackers see it in their menu.');
    } else setError(r.status === 400 ? 'Too long: the schedule fits 5,000 characters, emergency info 2,000.' : errorText(r));
  }

  return (
    <div className="grid gap-[24px] min-w-0 pb-[32px] [&_button:focus-visible]:[outline:2px_solid_var(--accent)]

          [&_button:focus-visible]:[outline-offset:3px]

          [&_textarea:focus-visible]:[outline:2px_solid_var(--accent)]

          [&_textarea:focus-visible]:[outline-offset:3px]">
      <header className="p-[8px_0px] [&_h1]:m-0 [&_h1]:text-[clamp(1.8rem,_3vw,_2.3rem)] [&_h1]:tracking-[-0.045em]">
        <div>
          <p className="m-[0px_0px_8px] text-accent text-[0.72rem] [font-weight:750] tracking-[0.12em]">EVENT MANAGEMENT</p>
          <h1>Info for hackers</h1>
          <p className="max-w-[680px] m-[7px_0px_0px] text-muted-foreground text-[0.9rem] leading-[1.65]">
            Shown on each accepted hacker’s Schedule and Emergency contact pages. Plain text; line breaks are kept. In the schedule, a line like 12:00-13:00 | Lunch | Cafeteria shows as a time slot, under the line above it (e.g. Saturday, Nov 7).
          </p>
        </div>
      </header>
      {error && (
        <Alert className="flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]

          leading-[1.65] [overflow-wrap:anywhere]

          [&&]:[border-color:color-mix(in_srgb,_var(--bad,_#f87171)_40%,_var(--line))]

          [&&]:[background:color-mix(in_srgb,_#f87171_6%,_var(--card))]" asChild><p  role="alert">
          ✕ {error}
        </p></Alert>
      )}
      {message && (
        <Alert className="flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]

          leading-[1.65] [overflow-wrap:anywhere]

          [&&]:[border-color:color-mix(in_srgb,_var(--ok,_#4ade80)_40%,_var(--line))]

          [&&]:[background:color-mix(in_srgb,_#4ade80_6%,_var(--card))]" asChild role="status"><p  role="status">
          {message}
        </p></Alert>
      )}
      {!info ? (
        <p className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Loading event information…</p>
      ) : (
        <form className="grid gap-[20px] max-w-[1100px]" onSubmit={(e) => void save(e)}>
          <section className="grid gap-[22px] min-w-0 p-[24px] [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-ticket max-[600.001px]:p-[18px] [&_.tw-admin-field]:grid

          [&_.tw-admin-field]:gap-[10px] [&_.tw-admin-field]:text-[0.84rem] [&_.tw-admin-field]:[font-weight:650]">
            <div className="flex items-start gap-[14px] [&_h2]:m-0 [&_h2]:text-[1.08rem] [&_h2]:tracking-[-0.02em]">
              <div>
                <h2>Event schedule</h2>
                <p className="max-w-[680px] m-[7px_0px_0px] text-muted-foreground text-[0.9rem] leading-[1.65]">Timings for check-in, sessions, meals, and activities.</p>
              </div>
            </div>
            <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
              Schedule
              <Textarea
                className="tw-admin-input w-full"
                maxLength={5000}
                value={info.schedule}
                onChange={(e) => setInfo({ ...info, schedule: e.target.value })}
                placeholder={'Saturday, Nov 7\n9:00-10:00 | Check-in | Main lobby\n10:00-10:30 | Opening ceremony | Auditorium\n12:00-13:00 | Lunch | Cafeteria'}
              />
              <span className="[justify-self:end] text-muted-foreground text-[0.75rem] font-medium tabular-nums" aria-hidden="true">
                {info.schedule.length.toLocaleString()} / 5,000 characters
              </span>
            </Label>
          </section>
          <section className="grid gap-[22px] min-w-0 p-[24px] [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-ticket max-[600.001px]:p-[18px] [&_.tw-admin-field]:grid

          [&_.tw-admin-field]:gap-[10px] [&_.tw-admin-field]:text-[0.84rem] [&_.tw-admin-field]:[font-weight:650]">
            <div className="flex items-start gap-[14px] [&_h2]:m-0 [&_h2]:text-[1.08rem] [&_h2]:tracking-[-0.02em]">
              <div>
                <h2>Emergency information</h2>
                <p className="max-w-[680px] m-[7px_0px_0px] text-muted-foreground text-[0.9rem] leading-[1.65]">Important contacts and emergency instructions.</p>
              </div>
            </div>
            <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
              Emergency info
              <Textarea
                className="tw-admin-input w-full"
                maxLength={2000}
                value={info.emergencyInfo}
                onChange={(e) => setInfo({ ...info, emergencyInfo: e.target.value })}
                placeholder={'Organizer on call: …\nVenue security: …\nIn a life-threatening emergency, call 911.'}
              />
              <span className="[justify-self:end] text-muted-foreground text-[0.75rem] font-medium tabular-nums" aria-hidden="true">
                {info.emergencyInfo.length.toLocaleString()} / 2,000 characters
              </span>
            </Label>
          </section>
          <section className="grid gap-[22px] min-w-0 p-[24px] [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-ticket max-[600.001px]:p-[18px] [&_.tw-admin-field]:grid

          [&_.tw-admin-field]:gap-[10px] [&_.tw-admin-field]:text-[0.84rem] [&_.tw-admin-field]:[font-weight:650]">
            <div className="flex items-start gap-[14px] [&_h2]:m-0 [&_h2]:text-[1.08rem] [&_h2]:tracking-[-0.02em]">
              <div>
                <h2>RSVP deadline</h2>
                <p className="max-w-[680px] m-[7px_0px_0px] text-muted-foreground text-[0.9rem] leading-[1.65]">When unanswered invitations close.</p>
              </div>
            </div>
            <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
              RSVP deadline ({info.timezone})
              <Input className="tw-admin-input w-full" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              <span className="text-muted-foreground text-[0.78rem] font-normal leading-[1.5]">
                No reply by then counts as a no. Invitees get a reminder at 10:00 on the deadline day and the two days before. Someone invited late gets 48 hours. Leave it empty for no deadline.
              </span>
            </Label>
          </section>
          <div className="flex items-center justify-between gap-[20px] max-w-[1100px] p-[4px_0px] max-[600.001px]:items-stretch

          max-[600.001px]:flex-col">
            <p className="max-w-[480px] m-0 text-muted-foreground text-[0.8rem] leading-[1.6]">Save your changes to update the information shown to hackers.</p>
            <div className="flex items-center gap-[10px] max-[600.001px]:w-full max-[600.001px]:[&_button]:flex-1">
              <Button type="submit" variant="secondary" className="shrink-0 max-[600px]:w-full" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
