
import { Entrance } from '@/components/motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { normalizeUid } from '@/lib/domain/badge';
import { normalizeEmail } from '@/lib/domain/normalize';
import { connect, connectionState, type ConnectionState } from '@/lib/me/connections';
import { CopyButton } from './copy-button';

// SPEC §6.5: what a phone opens when it taps a badge. Public since v0.9: no sign-in needed, and
// badge_profile() returns the holder's name and, only while they share them, their links (v0.11.3).
// The holder's own tap opens their menu.
// Staff link unlinked badges at check-in (v0.10). v0.9.2: Discord and website too.
// `?tap` (on tags written by the earlier datathon-badges app) is ignored.
export const metadata: Metadata = {
  title: 'Badge · Datathon',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

const profileSchema = z
  .union([
    z.object({ allowed: z.literal(true), public: z.literal(false), firstName: z.string(), lastName: z.string() }),
    z.object({
      allowed: z.literal(true),
      public: z.literal(true),
      firstName: z.string(),
      lastName: z.string(),
      linkedinUrl: z.string().nullable(),
      discord: z.string().nullable(),
      websiteUrl: z.string().nullable(),
    }),
  ])
  .nullable();

// "https://ada.dev/" → "ada.dev", "https://github.com/ada" → "github.com/ada".
const siteLabel = (href: string) => {
  const url = new URL(href);
  return `${url.host}${url.pathname}${url.search}`.replace(/\/$/, '');
};

// SPEC F16 (v0.12): Connect is a POST from a button (I-17); the tapper is the signed-in account, never the badge.
async function connectAction(formData: FormData) {
  'use server';
  const uid = normalizeUid(String(formData.get('uid') ?? ''));
  if (!uid) notFound();
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/profile/${uid}`)}`);
  const { code } = await connect(db(), user, uid);
  redirect(`/profile/${uid}${code === 'RATE_LIMITED' ? '?c=RATE_LIMITED' : ''}`);
}

export default async function BadgeProfilePage(props: { params: Promise<{ uid: string }>; searchParams: Promise<{ c?: string }> }) {
  await connection(); // per request: an opt-out must take effect on the next view
  const raw = (await props.params).uid;
  const uid = normalizeUid(raw);
  if (!uid) notFound();
  const viewer = await currentUser();

  const { data, error } = await db().rpc('badge_profile', {
    p_uid: uid,
    ...(viewer && { p_viewer_id: viewer.id, p_viewer_email: normalizeEmail(viewer.email ?? '') }),
  });
  if (error) throw new Error(`badge_profile failed (${error.code})`);
  // v0.6 (F14): the holder tapping their own badge opens their hacker menu.
  if (z.object({ self: z.literal(true) }).safeParse(data).success) redirect('/me');
  const profile = profileSchema.parse(data);
  const state: ConnectionState | null = profile && viewer ? await connectionState(db(), viewer, uid) : null;
  const limited = (await props.searchParams).c === 'RATE_LIMITED';

  return (
    <Entrance><main className="max-w-[480px] lg:pointer-fine:max-w-[760px]  m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
      <div className="flex items-center justify-between gap-[16px] min-h-[44px] pb-[4px] mb-[8px] [border-bottom-width:1px]

          [border-bottom-style:solid] [border-bottom-color:var(--line)]">
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-[12px] tracking-[0.08em]

          uppercase">Event badge</span>
      </div>
      <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section >
        {profile === null && (
          <>
            <h1>This badge isn’t linked yet</h1>
            <p>Staff link badges at the check-in desk.</p>
          </>
        )}
        {profile && (
          <h1 className="text-[28px] font-semibold leading-[1.2]">{`${profile.firstName} ${profile.lastName}`.trim()}</h1>
        )}
        {profile && !profile.public && <p>{profile.firstName} keeps their links private.</p>}
        {profile?.public && (
          <>
            {profile.linkedinUrl && (
              <Button className="self-start" asChild><a  href={profile.linkedinUrl} rel="noopener noreferrer">
                View LinkedIn profile
              </a></Button>
            )}
            {profile.discord && (
              <div className="flex flex-wrap items-center gap-[4px_12px] min-h-[44px] pt-[12px] [border-top-width:1px]

          [border-top-style:solid] [border-top-color:var(--line)]">
                <span className="text-muted-foreground text-[12px] tracking-[0.08em] uppercase min-w-[72px]">Discord</span>
                <span className="flex-1 min-w-0 [overflow-wrap:anywhere] font-semibold">@{profile.discord}</span>
                <CopyButton text={profile.discord} label="Copy Discord username" />
              </div>
            )}
            {profile.websiteUrl && (
              <div className="flex flex-wrap items-center gap-[4px_12px] min-h-[44px] pt-[12px] [border-top-width:1px]

          [border-top-style:solid] [border-top-color:var(--line)]">
                <span className="text-muted-foreground text-[12px] tracking-[0.08em] uppercase min-w-[72px]">Website</span>
                {/* The holder typed this link: nofollow/ugc, and its address is the label so the tapper sees where it goes. */}
                <a className="flex-1 min-w-0 [overflow-wrap:anywhere] font-semibold" href={profile.websiteUrl} rel="nofollow noopener noreferrer ugc">
                  {siteLabel(profile.websiteUrl)}
                </a>
              </div>
            )}
            {!profile.linkedinUrl && !profile.discord && !profile.websiteUrl && <p>No links shared.</p>}
          </>
        )}
        {profile && !viewer && (
          <Button className="self-start" variant="outline" asChild>
            <a href={`/login?next=${encodeURIComponent(`/profile/${uid}`)}`}>Sign in to connect</a>
          </Button>
        )}
        {profile && state && <Connect uid={uid} firstName={profile.firstName} state={state} />}
        {limited && <p role="alert" className="text-bad">✕ Too many connects in a short time. Wait a few minutes and try again.</p>}
      </section></Card>
    </main></Entrance>
  );
}

// The connection game (F16): what the signed-in viewer can do with this badge. Not an attendee of this event,
// an unknown badge or their own: nothing.
function Connect(props: { uid: string; firstName: string; state: ConnectionState }) {
  const { uid, firstName: name, state } = props;
  const button = (label: string) => (
    <form action={connectAction}>
      <input type="hidden" name="uid" value={uid} />
      <Button type="submit">{label}</Button>
    </form>
  );
  const box = 'grid gap-[8px] pt-[12px] [border-top-width:1px] [border-top-style:solid] [border-top-color:var(--line)]';
  switch (state) {
    case 'NONE':
      return <div className={box}>{button(`Connect with ${name}`)}</div>;
    case 'RECEIVED':
      return (
        <div className={box}>
          <p className="m-0">{name} tapped your badge. Connect back to make it count.</p>
          {button(`Connect back with ${name}`)}
        </div>
      );
    case 'SENT':
      return <p role="status" className={`${box} m-0`}>Sent! It counts once {name} taps your badge too.</p>;
    case 'MUTUAL':
      return <p role="status" className={`${box} m-0 text-ok`}>✓ You’re connected with {name}.</p>;
    case 'NOT_CHECKED_IN':
      return <p className={`${box} m-0 text-muted-foreground`}>Check in at the door first, then you can connect.</p>;
    case 'CLOSED':
      return <p className={`${box} m-0 text-muted-foreground`}>Connecting closed when the event ended.</p>;
    default:
      return null;
  }
}
