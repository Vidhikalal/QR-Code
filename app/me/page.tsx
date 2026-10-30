
import { Entrance } from '@/components/motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { db } from '@/lib/db/server';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { env } from '@/lib/env';
import { myConnections, myRank } from '@/lib/me/connections';
import { myPasses } from '@/lib/pass/mine';
import { ConnectionList } from './connections/list';
import { ChevronIcon, EmergencyIcon, ProfileIcon, QrIcon, ScheduleIcon, TeamIcon } from './icons';
import { loadMe, menuMetadata } from './load';

export const metadata: Metadata = menuMetadata('Menu');

// SPEC F14 (v0.6.1): the hacker menu for your event (tapping your own badge opens it), and links for staff
// (v0.4.1). The pass link carries the token only in the fragment (I-3), and the page never sends a referrer.
export default async function MePage() {
  const { user, now, me: m } = await loadMe('/me');
  const pass = m ? (await myPasses(db(), user.email ?? '', env().PASS_TOKEN_SECRET, new Date())).find((p) => p.participantId === m.participantId)?.pass : undefined;
  // v0.4.1: staff get links to their events (the admin and scanner pages check the role again).
  const { data: roles, error } = await db()
    .from('event_staff')
    .select('role, events!inner(slug, name, starts_at)')
    .eq('user_id', user.id)
    .order('starts_at', { referencedTable: 'events', ascending: false });
  if (error) throw new Error(`event_staff lookup failed (${error.code})`);

  // F16: own row only (myEvent). The rank is on the projector's board (as of the freeze, if frozen).
  const [connections, rank] = m ? await Promise.all([myConnections(db(), m.participantId, 5), myRank(db(), m.participantId)]) : [null, null];
  const live = m ? Date.parse(m.event.endsAt) > now.getTime() : false;
  const teamHint = !m ? '' : m.teamId ? 'You’re in a team' : !live ? '' : m.event.teamsOpen ? 'Create or join a team' : 'Opens on hackathon day';

  return (
    <Entrance><main className="max-w-[480px] lg:pointer-fine:max-w-[760px]  m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0 tw-me-dashboard w-full max-w-[760px] [&_.tw-me-hero]:relative

          [&_.tw-me-hero]:gap-[6px] [&_.tw-me-hero]:[justify-items:center] [&_.tw-me-hero]:[align-content:center]

          [&_.tw-me-hero]:text-center [&_.tw-me-hero]:p-[28px_24px] [&_.tw-me-hero]:[border-width:1px]

          [&_.tw-me-hero]:[border-style:solid] [&_.tw-me-hero]:[border-top-color:var(--line)]

          [&_.tw-me-hero]:[border-right-color:var(--line)] [&_.tw-me-hero]:[border-bottom-color:var(--line)]

          [&_.tw-me-hero]:[border-left-color:var(--line)] [&_.tw-me-hero]:rounded-card

          [&_.tw-me-hero]:[background:linear-gradient(_125deg,_color-mix(in_srgb,_var(--accent)_7%,_transparent),_transparent_65%_),_var(--card)]

          [&_.tw-me-hero]:shadow-panel max-[520.001px]:[&_.tw-me-hero]:p-[20px_16px]

          [&_.tw-me-hero_h1]:text-[clamp(26px,_4vw,_38px)] [&_.tw-me-hero_h1]:leading-[1.15]

          [&_.tw-me-hero_h1]:tracking-[-0.045em] [&_.tw-me-hero_p]:text-[14px] [&_.tw-me-hero_p]:leading-[1.6]

          [&_.tw-me-nav]:gap-[14px] [&_.tw-me-pass]:relative [&_.tw-me-pass]:min-h-[104px]

          [&_.tw-me-pass]:p-[20px] [&_.tw-me-pass]:rounded-ticket

          [&_.tw-me-pass]:[box-shadow:rgba(184,_220,_255,_0.07)_0px_1px_0px_inset,_rgb(0,_0,_0)_0px_16px_40px_-24px]

          max-[520.001px]:[&_.tw-me-pass]:p-[16px] max-[520.001px]:[&_.tw-me-pass]:gap-[12px]

          [&_a.tw-me-pass]:[border-color:color-mix(in_srgb,_var(--accent)_45%,_var(--line))]

          [&_a.tw-me-pass:hover]:[transform:translateY(-2px)] [&_a.tw-me-pass:hover]:border-accent

          [&_a.tw-me-pass:hover]:[background:color-mix(in_srgb,_var(--accent)_12%,_var(--card))]

          [&_.tw-me-passIcon]:w-[56px] [&_.tw-me-passIcon]:h-[56px] [&_.tw-me-passIcon]:rounded-card

          [&_.tw-me-passText]:gap-[4px] [&_.tw-me-passText]:text-[19px] [&_.tw-me-passText]:tracking-[-0.02em]

          [&_.tw-me-passText_small]:leading-[1.5] [&_.tw-me-menu]:rounded-ticket [&_.tw-me-item]:min-h-[72px]

          [&_.tw-me-item]:p-[14px_18px] [&_.tw-me-item]:gap-[16px] max-[520.001px]:[&_.tw-me-item]:p-[12px_14px]

          [&_.tw-me-item:hover]:[background:color-mix(in_srgb,_var(--accent)_5%,_var(--raised))]

          [&_.tw-me-itemText]:gap-[3px] [&_.tw-me-itemText_small]:leading-[1.5] [&_.tw-me-itemIcon]:w-[23px]

          [&_.tw-me-itemIcon]:h-[23px]

          [&_.tw-me-chevron]:[transition:transform_0.2s_var(--ease),_color_0.2s_var(--ease)]

          [&_.tw-me-item:hover_.tw-me-chevron]:text-accent

          [&_.tw-me-item:hover_.tw-me-chevron]:[transform:translateX(3px)] [&_.tw-me-staff]:gap-[14px]

          [&_.tw-me-staff_h2]:text-[17px] [&_.tw-me-staff_h2]:tracking-[-0.02em]

          [&_.tw-me-staff_>_div]:rounded-ticket [&_.tw-me-staff_>_div]:[transition:border-color_0.2s_var(--ease)]

          [&_.tw-me-staff_>_div:hover]:[border-color:color-mix(in_srgb,_var(--accent)_35%,_var(--line))]

          [&_.tw-me-footer]:mt-[4px] [&_.tw-me-footer]:pt-[20px]">
      {m ? (
        <>
          <header className="tw-me-hero grid gap-[4px] [overflow-wrap:anywhere] [&_h1]:m-[0px_0px_4px] [&_h1]:text-[32px]

          [&_h1]:leading-[1.15] [&_p]:m-0 [&_p]:text-muted-foreground [&_p]:text-[14px]">
            <h1>{m.event.name}</h1>
            <p>{formatEventDateTime(m.event.startsAt, m.event.timezone)}</p>
            <p>{m.event.venue}</p>
          </header>
          <p>Hi {m.firstName}.</p>
          <nav aria-label="Hacker menu" className="tw-me-nav grid gap-[16px]">
            {typeof pass === 'object' ? (
              // A plain link: the token is in the fragment (I-3), which client navigation must not touch.
              <a className="tw-me-pass flex items-center gap-[16px] min-h-[88px] p-[16px_20px] [border-width:1px]

          [border-style:solid] [border-top-color:color-mix(in_srgb,_var(--accent)_45%,_transparent)]

          [border-right-color:color-mix(in_srgb,_var(--accent)_45%,_transparent)]

          [border-bottom-color:color-mix(in_srgb,_var(--accent)_45%,_transparent)]

          [border-left-color:color-mix(in_srgb,_var(--accent)_45%,_transparent)] rounded-card

          [background:color-mix(in_srgb,_var(--accent)_8%,_var(--card))] shadow-panel text-fg no-underline

          [transition:border-color_0.16s_var(--ease),_background-color_0.16s_var(--ease)]

          [&:is(a):hover]:border-accent

          [&:is(a):hover]:[background:color-mix(in_srgb,_var(--accent)_14%,_var(--card))]

          [&:not(a)_.tw-me-passIcon]:[background:var(--raised)] [&:not(a)_.tw-me-passIcon]:text-muted-foreground

          [&:not(a)]:border-line [&:not(a)]:[background:var(--card)]" href={`/p#${pass.token}`}>
                <span className="tw-me-passIcon grid [place-items:center] [flex:0_0_auto] w-[52px] h-[52px] rounded-md

          [background:var(--accent)] text-accent-ink [&_svg]:w-[28px] [&_svg]:h-[28px]">
                  <QrIcon />
                </span>
                <span className="tw-me-passText grid gap-[2px] flex-1 min-w-0 text-[18px] font-semibold [&_small]:text-muted-foreground

          [&_small]:text-[14px] [&_small]:font-normal">
                  My pass
                  <small>Your QR code for the door</small>
                </span>
                <ChevronIcon className="tw-me-chevron [flex:0_0_auto] w-[18px] h-[18px] text-muted-foreground" />
              </a>
            ) : (
              <p className="tw-me-pass flex items-center gap-[16px] min-h-[88px] p-[16px_20px] [border-width:1px]

          [border-style:solid] [border-top-color:color-mix(in_srgb,_var(--accent)_45%,_transparent)]

          [border-right-color:color-mix(in_srgb,_var(--accent)_45%,_transparent)]

          [border-bottom-color:color-mix(in_srgb,_var(--accent)_45%,_transparent)]

          [border-left-color:color-mix(in_srgb,_var(--accent)_45%,_transparent)] rounded-card

          [background:color-mix(in_srgb,_var(--accent)_8%,_var(--card))] shadow-panel text-fg no-underline

          [transition:border-color_0.16s_var(--ease),_background-color_0.16s_var(--ease)]

          [&:is(a):hover]:border-accent

          [&:is(a):hover]:[background:color-mix(in_srgb,_var(--accent)_14%,_var(--card))]

          [&:not(a)_.tw-me-passIcon]:[background:var(--raised)] [&:not(a)_.tw-me-passIcon]:text-muted-foreground

          [&:not(a)]:border-line [&:not(a)]:[background:var(--card)]">
                <span className="tw-me-passIcon grid [place-items:center] [flex:0_0_auto] w-[52px] h-[52px] rounded-md

          [background:var(--accent)] text-accent-ink [&_svg]:w-[28px] [&_svg]:h-[28px]">
                  <QrIcon />
                </span>
                <span className="tw-me-passText grid gap-[2px] flex-1 min-w-0 text-[18px] font-semibold [&_small]:text-muted-foreground

          [&_small]:text-[14px] [&_small]:font-normal">
                  My pass
                  <small>{pass === 'in_email' ? 'In your email' : pass === 'on_its_way' ? 'On its way by email' : 'The event is over'}</small>
                </span>
              </p>
            )}
            <Entrance stagger><ul className="tw-me-menu m-0 p-0 list-none [border-width:1px] [border-style:solid] [border-top-color:var(--line)]

          [border-right-color:var(--line)] [border-bottom-color:var(--line)] [border-left-color:var(--line)]

          rounded-card [background:var(--card)] shadow-panel overflow-hidden [&_li_+_li]:[border-top-width:1px]

          [&_li_+_li]:[border-top-style:solid] [&_li_+_li]:[border-top-color:var(--line)]">
              <Item
                href="/me/profile"
                icon={<ProfileIcon className="tw-me-itemIcon [flex:0_0_auto] w-[22px] h-[22px] text-accent" />}
                label="Hacker profile"
                hint={!m.profileDone ? 'Finish setting up' : m.badge ? 'Badge linked' : 'No badge linked yet'}
                warn={!m.profileDone}
              />
              <Item href="/me/team" icon={<TeamIcon className="tw-me-itemIcon [flex:0_0_auto] w-[22px] h-[22px] text-accent" />} label="Team" hint={teamHint} />
              <Item href="/me/schedule" icon={<ScheduleIcon className="tw-me-itemIcon [flex:0_0_auto] w-[22px] h-[22px] text-accent" />} label="Schedule" hint={m.event.schedule ? '' : 'Not posted yet'} />
              <Item
                href="/me/emergency"
                icon={<EmergencyIcon className="tw-me-itemIcon [flex:0_0_auto] w-[22px] h-[22px] text-accent" />}
                label="Emergency contact"
                hint={m.emergency ? m.emergency.name : 'Not set'}
                warn={!m.emergency}
              />
            </ul></Entrance>
          </nav>
          {connections && (
            <Card className="[&>p]:m-0 [&>h2]:text-lg" asChild>
              <section aria-labelledby="connections-heading">
                <h2 id="connections-heading">Connections</h2>
                <p className="text-[28px] font-semibold leading-[1.2]">
                  {connections.total} {connections.total === 1 ? 'connection' : 'connections'}
                </p>
                {rank?.rank != null && <p className="font-semibold text-accent">You’re #{rank.rank} on the leaderboard.</p>}
                <p className="text-muted-foreground text-[14px]">
                  Tap someone’s badge and press Connect. It counts once they tap yours too.
                  {connections.waitingOn > 0 && ` Waiting on ${connections.waitingOn} ${connections.waitingOn === 1 ? 'person' : 'people'} to tap you back.`}
                </p>
                {connections.recent.length > 0 && <ConnectionList people={connections.recent} />}
                {connections.total > 0 && (
                  <Link className="inline-flex items-center min-h-[44px] text-accent font-semibold" href="/me/connections">
                    See all connections
                  </Link>
                )}
              </section>
            </Card>
          )}
        </>
      ) : (
        <h1>My events</h1>
      )}
      {roles.length > 0 && (
        <Entrance stagger><section aria-labelledby="staff-heading" className="tw-me-staff grid gap-[12px] [&_h2]:m-[8px_0px_0px] [&_h2]:text-[18px]">
          <h2 id="staff-heading">Staff</h2>
          {roles.map(({ role, events: e }) => (
            <Card key={e.slug} className="[&>p]:m-0 [&>h2]:text-lg ">
              <h3>{e.name}</h3>
              <p className="text-muted-foreground text-[12px] tracking-[0.08em] uppercase font-normal">{role === 'organizer' ? 'Organizer' : 'Volunteer'}</p>
              <div className="flex flex-wrap gap-[8px]">
                {role === 'organizer' && (
                  <Button className="self-start" asChild><a  href={`/admin/${e.slug}`} aria-label={`Admin: ${e.name}`}>
                    Admin
                  </a></Button>
                )}
                <Button className="self-start" asChild><a  href={`/scan/${e.slug}`} aria-label={`Scanner: ${e.name}`}>
                  Scanner
                </a></Button>
              </div>
            </Card>
          ))}
        </section></Entrance>
      )}
      {!m && roles.length === 0 && <p>No upcoming events yet. When you answer Yes to an invitation, your event shows up here.</p>}
      <footer className="tw-me-footer flex flex-wrap items-center justify-between gap-[12px] pt-[24px] [border-top-width:1px]

          [border-top-style:solid] [border-top-color:var(--line)] text-muted-foreground text-[14px] [&_p]:m-0 [&_p]:min-w-0

          [&_p]:[overflow-wrap:anywhere]">
        <p>Signed in as {user.email}.</p>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </footer>
    </main></Entrance>
  );
}

function Item(props: { href: string; icon: ReactNode; label: string; hint: string; warn?: boolean }) {
  return (
    <li>
      <Link className="tw-me-item flex items-center gap-[14px] min-h-[64px] p-[10px_16px] [color:inherit] no-underline

          [transition:background-color_0.16s_var(--ease)] [&:hover]:[background:var(--raised)]

          [&:focus-visible]:[outline-offset:-2px] [&:focus-visible]:rounded-card" href={props.href}>
        {props.icon}
        <span className="tw-me-itemText grid flex-1 min-w-0 [overflow-wrap:anywhere] text-[16px] font-semibold

          [&_small]:text-muted-foreground [&_small]:text-[13px] [&_small]:font-normal [&_small[data-tone='warn']]:text-warn">
          {props.label}
          {props.hint && <small data-tone={props.warn ? 'warn' : undefined}>{props.hint}</small>}
        </span>
        <ChevronIcon className="tw-me-chevron [flex:0_0_auto] w-[18px] h-[18px] text-muted-foreground" />
      </Link>
    </li>
  );
}
