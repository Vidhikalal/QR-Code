'use client';

import { useActionState, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { DISCORD_PATTERN, LINKEDIN_PATTERN, WEBSITE_PATTERN } from '@/lib/domain/badge';
import { PHONE_PATTERN } from '@/lib/domain/profile';
import type { SaveProfileResult } from '@/lib/me/profile';
import { saveNetworking, saveSetup, type SaveState } from './actions';

/** What /me/profile shows: the signed-in hacker's own answers, as stored. */
export interface ProfileValues {
  participantId: string;
  name: string;
  badge: boolean;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelation: string;
  overnight: string;
  teamStatus: string;
  allergies: string;
  allergySeverity: string;
  accessibility: string;
  linkedin: string;
  discord: string;
  website: string;
  profilePublic: boolean;
}

const ERRORS: Partial<Record<SaveProfileResult, string>> = {
  INVALID_LINKEDIN: '✕ Not saved. Use your LinkedIn profile link, like linkedin.com/in/yourname.',
  INVALID_DISCORD: '✕ Not saved. Use your Discord username: 2–32 lowercase letters, numbers, _ or . (no # tag).',
  INVALID_WEBSITE: '✕ Not saved. Use a website address under 200 characters, like yourname.dev.',
  INVALID_CONTACT: '✕ Not saved. Enter your emergency contact’s name and a phone number with at least 3 digits.',
  INVALID_OVERNIGHT: '✕ Not saved. Tell us whether you’re staying overnight.',
  INVALID_ALLERGY: '✕ Not saved. Say what you’re allergic to and how severe it is (300 characters or less), or switch allergies off.',
  INVALID_TEAM_STATUS: '✕ Not saved. Tell us about your team.',
  INVALID_ACCESSIBILITY: '✕ Not saved. Keep accessibility needs under 500 characters.',
  RATE_LIMITED: '✕ Not saved. Too many saves in a short time: wait a few minutes and try again.',
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

const FORM = `grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label_+_[data-slot=native-select-wrapper]]:mt-[-10px]
  [&_label]:text-[14px] [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]
  [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]
  [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]`;
const FIELDSET = `grid gap-[2px] m-0 p-0 [border-width:0px] [border-style:none] [border-color:currentcolor] min-w-0
  [&_legend]:p-0 [&_legend]:mb-[4px] [&_legend]:text-[14px] [&_legend]:font-medium`;
const CHOICE = 'flex gap-[10px] items-center min-h-[44px] [&_input]:[flex:0_0_auto] [&_input]:w-[22px] [&_input]:h-[22px]';
const HINT = 'm-0 text-muted-foreground text-[14px]';

function Notice(props: { state: SaveState; ok: string }) {
  if (!props.state) return null;
  if (props.state.result === 'SAVED') {
    return (
      <Alert className="text-ok" asChild role="status">
        <p role="status">{props.ok}</p>
      </Alert>
    );
  }
  return (
    <Alert className="text-bad" asChild>
      <p role="alert">{ERRORS[props.state.result] ?? ERRORS.NOT_FOUND}</p>
    </Alert>
  );
}

// SPEC F14 step 3: two cards, each with its own Save. Each card holds what was typed, so saving one (or a
// refused save) never clears the other. After a successful save, that card is remounted (its key is the save
// count) and shows the stored values, which refresh() has just sent.
export function ProfileForms(props: { values: ProfileValues }) {
  const [setupState, setupAction, setupPending] = useActionState(saveSetup, null);
  const [linksState, linksAction, linksPending] = useActionState(saveNetworking, null);
  return (
    <>
      <Card className="[&>p]:m-0 [&>h2]:text-lg" asChild>
        <section aria-label="Profile setup">
          <form action={setupAction} className={FORM}>
            <SetupFields key={setupState?.saves ?? 0} values={props.values} />
            <Notice state={setupState} ok="✓ Saved. Your profile is set up." />
            <Button type="submit" disabled={setupPending}>
              {setupPending ? 'Saving…' : 'Save profile'}
            </Button>
          </form>
        </section>
      </Card>

      <Card className="[&>p]:m-0 [&>h2]:text-lg" asChild>
        <section aria-labelledby="networking">
          <h2 id="networking">Networking</h2>
          <div className="grid gap-[4px]">
            <p className="text-muted-foreground text-[12px] tracking-[0.08em] uppercase">Name</p>
            <p className="text-[28px] font-semibold leading-[1.2]">{props.values.name}</p>
          </div>
          {props.values.badge ? (
            <p className="inline-flex items-center gap-[6px] [align-self:flex-start] p-[4px_10px] rounded-sm [background:color-mix(in_srgb,_var(--accent)_12%,_var(--card))] text-ok text-[14px]">
              ✓ Badge linked.
            </p>
          ) : (
            <p className={HINT}>No badge yet. Staff link badges at the check-in desk.</p>
          )}
          <form action={linksAction} className={FORM}>
            <NetworkingFields key={linksState?.saves ?? 0} values={props.values} />
            <Notice state={linksState} ok="✓ Saved." />
            <Button type="submit" disabled={linksPending}>
              {linksPending ? 'Saving…' : 'Save links'}
            </Button>
          </form>
        </section>
      </Card>
    </>
  );
}

function SetupFields({ values }: { values: ProfileValues }) {
  const [v, setV] = useState(values);
  const [hasAllergies, setHasAllergies] = useState(values.allergies !== '');
  const set = (key: keyof ProfileValues) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });
  return (
    <>
      <input type="hidden" name="participantId" value={v.participantId} />
      <h2>Emergency contact</h2>
      <p className={HINT}>Who we call if something happens to you.</p>
      <Label htmlFor="emergencyName">Emergency contact name</Label>
      <Input id="emergencyName" name="emergencyName" required maxLength={100} autoComplete="off" value={v.emergencyName} onChange={set('emergencyName')} className="min-h-12 w-full" />
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
        value={v.emergencyPhone}
        onChange={set('emergencyPhone')}
        className="min-h-12 w-full"
      />
      <Label htmlFor="emergencyRelation">Relationship (optional)</Label>
      <Input
        id="emergencyRelation"
        name="emergencyRelation"
        maxLength={60}
        placeholder="Parent, partner, friend…"
        autoComplete="off"
        value={v.emergencyRelation}
        onChange={set('emergencyRelation')}
        className="min-h-12 w-full"
      />

      <h2>The event</h2>
      <fieldset className={FIELDSET}>
        <legend>Staying overnight?</legend>
        {OVERNIGHT.map(([value, label]) => (
          <Label key={value} className={CHOICE}>
            <input type="radio" name="overnight" value={value} required checked={v.overnight === value} onChange={set('overnight')} />
            {label}
          </Label>
        ))}
      </fieldset>
      <fieldset className={FIELDSET}>
        <legend>Your team</legend>
        {TEAM.map(([value, label]) => (
          <Label key={value} className={CHOICE}>
            <input type="radio" name="teamStatus" value={value} required checked={v.teamStatus === value} onChange={set('teamStatus')} />
            {label}
          </Label>
        ))}
      </fieldset>

      <h2>Health and access</h2>
      {/* Allergies sit behind a switch: on, both fields are required; off hides them and saving clears them. */}
      <Label className={CHOICE}>
        <input type="checkbox" role="switch" name="hasAllergies" checked={hasAllergies} onChange={(e) => setHasAllergies(e.target.checked)} />
        I have allergies
      </Label>
      {hasAllergies && (
        <>
          <Label htmlFor="allergies">What are you allergic to?</Label>
          <Input id="allergies" name="allergies" required maxLength={300} placeholder="Peanuts, shellfish…" autoComplete="off" value={v.allergies} onChange={set('allergies')} className="min-h-12 w-full" />
          <Label htmlFor="allergySeverity">How severe?</Label>
          <NativeSelect id="allergySeverity" name="allergySeverity" required value={v.allergySeverity} onChange={set('allergySeverity')} className="min-h-12">
            <option value="">Choose how severe</option>
            <option value="mild">Mild</option>
            <option value="moderate">Moderate</option>
            <option value="severe">Severe: life-threatening (e.g. I carry an EpiPen)</option>
          </NativeSelect>
        </>
      )}
      <p className={HINT}>Separate from dietary preferences. Volunteers serving food see your allergy.</p>
      <Label htmlFor="accessibility">Accessibility needs (optional)</Label>
      <Textarea
        id="accessibility"
        name="accessibility"
        maxLength={500}
        placeholder="Anything that would make the event easier for you"
        value={v.accessibility}
        onChange={set('accessibility')}
        className="min-h-12 w-full"
      />
    </>
  );
}

function NetworkingFields({ values }: { values: ProfileValues }) {
  const [v, setV] = useState(values);
  const set = (key: keyof ProfileValues) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });
  return (
    <>
      <input type="hidden" name="participantId" value={v.participantId} />
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
        value={v.linkedin}
        onChange={set('linkedin')}
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
        value={v.discord}
        onChange={set('discord')}
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
        value={v.website}
        onChange={set('website')}
        className="min-h-12 w-full"
      />
      <Label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
        <input type="checkbox" name="public" checked={v.profilePublic} onChange={(e) => setV({ ...v, profilePublic: e.target.checked })} style={{ width: 22, height: 22 }} />
        Show these links to anyone who taps my badge (your name is always shown)
      </Label>
    </>
  );
}
