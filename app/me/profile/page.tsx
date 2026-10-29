
import { Entrance } from '@/components/motion';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { DISCORD_PATTERN, LINKEDIN_PATTERN, WEBSITE_PATTERN } from '@/lib/domain/badge';
import { PHONE_PATTERN } from '@/lib/domain/profile';
import { saveBadgeProfile, type SaveProfileResult } from '@/lib/me/profile';
import { loadMyEvent, menuMetadata } from '../load';
import { AllergyFields } from './allergy-fields';

export const metadata: Metadata = menuMetadata('Hacker profile');

const ERRORS: Partial<Record<SaveProfileResult, string>> = {
  INVALID_LINKEDIN: '✕ Not saved. Use your LinkedIn profile link, like linkedin.com/in/yourname.',
  INVALID_DISCORD: '✕ Not saved. Use your Discord username: 2–32 lowercase letters, numbers, _ or . (no # tag).',
  INVALID_WEBSITE: '✕ Not saved. Use a website address under 200 characters, like yourname.dev.',
  INVALID_CONTACT: '✕ Not saved. Enter your emergency contact’s name and a phone number with at least 3 digits.',
  INVALID_OVERNIGHT: '✕ Not saved. Tell us whether you’re staying overnight.',
  INVALID_ALLERGY: '✕ Not saved. Pick how severe your allergy is (or clear the allergy field), in 300 characters or less.',
  INVALID_TEAM_STATUS: '✕ Not saved. Tell us about your team.',
  INVALID_ACCESSIBILITY: '✕ Not saved. Keep accessibility needs under 500 characters.',
  NOT_FOUND: '✕ Not saved. Reload the page and try again.',
};

const OVERNIGHT = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['unsure', 'Not sure yet'],
] as const;
const TEAM = [
  ['team', 'I have a team'],
  ['looking', 'I’m looking for a team (lists my name in the teammate directory)'],
  ['solo', 'I plan to go solo'],
] as const;

const text = (formData: FormData, key: string) => String(formData.get(key) ?? '');

// SPEC F14 (v0.9): profile setup after the RSVP Yes. The emergency contact, overnight and team status are
// required; allergies (with how severe) and accessibility are optional. Only the organizers see them, and
// meal volunteers see the allergies.
async function saveSetup(formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login?next=/me/profile');
  const result = await saveBadgeProfile(
    db(),
    user,
    text(formData, 'participantId'),
    {
      emergencyName: text(formData, 'emergencyName'),
      emergencyPhone: text(formData, 'emergencyPhone'),
      emergencyRelation: text(formData, 'emergencyRelation'),
      overnight: text(formData, 'overnight'),
      allergies: text(formData, 'allergies'),
      allergySeverity: text(formData, 'allergySeverity'),
      teamStatus: text(formData, 'teamStatus'),
      accessibility: text(formData, 'accessibility'),
    },
    { setup: true },
  );
  redirect(`/me/profile?${result === 'SAVED' ? 'saved=setup' : `error=${result}`}`);
}

// SPEC F14 / §6.5: the attendee's own LinkedIn, Discord username and website (v0.9.2), and badge sharing. Dietary notes come from the Sheet and only
// organizers see them (v0.8.2): no key here, so the stored notes stay as they are.
async function saveNetworking(formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login?next=/me/profile');
  const result = await saveBadgeProfile(db(), user, text(formData, 'participantId'), {
    linkedin: text(formData, 'linkedin'),
    discord: text(formData, 'discord'),
    website: text(formData, 'website'),
    profilePublic: formData.get('public') === 'on',
  });
  redirect(`/me/profile?${result === 'SAVED' ? 'saved=1' : `error=${result}`}`);
}

export default async function HackerProfilePage(props: {
  searchParams: Promise<{ saved?: string; error?: string; setup?: string }>;
}) {
  const notices = await props.searchParams;
  const { me: m } = await loadMyEvent('/me/profile');
  const error = ERRORS[notices.error as SaveProfileResult];
  const networkingError = ['INVALID_LINKEDIN', 'INVALID_DISCORD', 'INVALID_WEBSITE'].includes(notices.error ?? '');

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
      <h1>{m.profileDone ? 'Hacker profile' : 'Finish setting up your profile'}</h1>
      {!m.profileDone && <p className="m-0 text-muted-foreground text-[14px]">A few things we need before {m.event.name}. They stay with the organizers; volunteers serving food see your allergy.</p>}

      <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section aria-label="Profile setup" >
        <form action={saveSetup} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
          <input type="hidden" name="participantId" value={m.participantId} />
          <h2>Emergency contact</h2>
          <p className="m-0 text-muted-foreground text-[14px]">Who we call if something happens to you.</p>
          <Label htmlFor="emergencyName">Emergency contact name</Label>
          <Input id="emergencyName" name="emergencyName" required maxLength={100} autoComplete="off" defaultValue={m.emergency?.name ?? ''} className="min-h-12 w-full" />
          <Label htmlFor="emergencyPhone">Emergency contact phone</Label>
          <Input
            id="emergencyPhone"
            name="emergencyPhone"
            type="tel"
            required
            maxLength={30}
            pattern={PHONE_PATTERN}
            title="A phone number: digits, spaces and + ( ) - ."
            autoComplete="off"
            defaultValue={m.emergency?.phone ?? ''}
            className="min-h-12 w-full"
          />
          <Label htmlFor="emergencyRelation">Relationship (optional)</Label>
          <Input
            id="emergencyRelation"
            name="emergencyRelation"
            maxLength={60}
            placeholder="Parent, partner, friend…"
            autoComplete="off"
            defaultValue={m.emergency?.relation ?? ''}
            className="min-h-12 w-full"
          />

          <h2>The event</h2>
          <fieldset className="grid gap-[2px] m-0 p-0 [border-width:0px] [border-style:none] [border-color:currentcolor] min-w-0

          [&_legend]:p-0 [&_legend]:mb-[4px] [&_legend]:text-[14px] [&_legend]:font-medium">
            <legend>Staying overnight?</legend>
            {OVERNIGHT.map(([value, label]) => (
              <Label key={value} className="flex gap-[10px] items-center min-h-[44px] [&_input]:[flex:0_0_auto] [&_input]:w-[22px]

          [&_input]:h-[22px]">
                <input type="radio" name="overnight" value={value} required defaultChecked={m.overnight === value} />
                {label}
              </Label>
            ))}
          </fieldset>
          <fieldset className="grid gap-[2px] m-0 p-0 [border-width:0px] [border-style:none] [border-color:currentcolor] min-w-0

          [&_legend]:p-0 [&_legend]:mb-[4px] [&_legend]:text-[14px] [&_legend]:font-medium">
            <legend>Your team</legend>
            {TEAM.map(([value, label]) => (
              <Label key={value} className="flex gap-[10px] items-center min-h-[44px] [&_input]:[flex:0_0_auto] [&_input]:w-[22px]

          [&_input]:h-[22px]">
                <input type="radio" name="teamStatus" value={value} required defaultChecked={m.teamStatus === value} />
                {label}
              </Label>
            ))}
          </fieldset>

          <h2>Health and access</h2>
          <AllergyFields allergies={m.allergies ?? ''} severity={m.allergySeverity ?? ''} inputClass={`min-h-[48px] p-[0px_12px] [font:inherit] [background:var(--raised)] text-fg [border-width:1px]
                [border-style:solid] [border-top-color:var(--field)] [border-right-color:var(--field)]
                [border-bottom-color:var(--field)] [border-left-color:var(--field)] rounded-control
                [&:is(select)]:min-w-0 [&:is(select)]:w-full`} hintClass={" m-0 text-muted-foreground text-[14px]"} />
          <Label htmlFor="accessibility">Accessibility needs (optional)</Label>
          <Textarea id="accessibility" name="accessibility" maxLength={500} placeholder="Anything that would make the event easier for you" defaultValue={m.accessibility ?? ''} className="min-h-12 w-full" />

          {error && !networkingError && (
            <Alert className="text-bad" asChild><p role="alert" >
              {error}
            </p></Alert>
          )}
          {notices.saved === 'setup' && (
            <Alert className="text-ok" asChild role="status"><p role="status" >
              ✓ Saved. Your profile is set up.
            </p></Alert>
          )}
          <Button type="submit">Save profile</Button>
        </form>
      </section></Card>

      <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section aria-labelledby="networking" >
        <h2 id="networking">Networking</h2>
        <div className="grid gap-[4px]">
          <p className="text-muted-foreground text-[12px] tracking-[0.08em] uppercase">Name</p>
          <p className="text-[28px] font-semibold leading-[1.2]">{`${m.firstName} ${m.lastName}`.trim()}</p>
        </div>
        {m.badge ? <p className="inline-flex items-center gap-[6px] [align-self:flex-start] p-[4px_10px] rounded-sm

          [background:color-mix(in_srgb,_var(--accent)_12%,_var(--card))] text-ok text-[14px]

          [&[data-tone='muted']]:[background:var(--raised)] [&[data-tone='muted']]:text-muted-foreground">✓ Badge linked.</p> : <p className="m-0 text-muted-foreground text-[14px]">No badge yet. Staff link badges at the check-in desk.</p>}
        <form action={saveNetworking} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
          <input type="hidden" name="participantId" value={m.participantId} />
          <Label htmlFor="linkedin">LinkedIn (optional)</Label>
          <Input
            id="linkedin"
            name="linkedin"
            inputMode="url"
            maxLength={200}
            pattern={LINKEDIN_PATTERN}
            title="Your LinkedIn profile link, like linkedin.com/in/yourname"
            autoComplete="url"
            placeholder="linkedin.com/in/yourname"
            defaultValue={m.linkedinUrl ?? ''}
            className="min-h-12 w-full"
          />
          <Label htmlFor="discord">Discord username (optional)</Label>
          <Input
            id="discord"
            name="discord"
            maxLength={33}
            pattern={DISCORD_PATTERN}
            title="Your Discord username: 2–32 letters, numbers, _ or ."
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            placeholder="yourname"
            defaultValue={m.discordUsername ?? ''}
            className="min-h-12 w-full"
          />
          <Label htmlFor="website">Website (optional)</Label>
          <Input
            id="website"
            name="website"
            inputMode="url"
            maxLength={200}
            pattern={WEBSITE_PATTERN}
            title="A website address, like yourname.dev"
            autoComplete="url"
            placeholder="yourname.dev"
            defaultValue={m.websiteUrl ?? ''}
            className="min-h-12 w-full"
          />
          <Label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" name="public" defaultChecked={m.profilePublic} style={{ width: 22, height: 22 }} />
            Show my name and these links to anyone who taps my badge
          </Label>
          {networkingError && (
            <Alert className="text-bad" asChild><p role="alert" >
              {error}
            </p></Alert>
          )}
          {notices.saved === '1' && (
            <Alert className="text-ok" asChild role="status"><p role="status" >
              ✓ Saved.
            </p></Alert>
          )}
          <Button type="submit">Save links</Button>
        </form>
      </section></Card>
    </main></Entrance>
  );
}
