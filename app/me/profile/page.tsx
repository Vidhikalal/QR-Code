import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { DISCORD_PATTERN, LINKEDIN_PATTERN, WEBSITE_PATTERN } from '@/lib/domain/badge';
import { PHONE_PATTERN } from '@/lib/domain/profile';
import { saveBadgeProfile, type SaveProfileResult } from '@/lib/me/profile';
import formStyles from '../../login/login.module.css';
import styles from '../../profile/[uid]/profile.module.css';
import me from '../me.module.css';
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
    <main className={styles.page}>
      <div className={styles.top}>
        <Link className={me.back} href="/me">
          ← Menu
        </Link>
        <span className={styles.context}>{m.event.name}</span>
      </div>
      <h1>{m.profileDone ? 'Hacker profile' : 'Finish setting up your profile'}</h1>
      {!m.profileDone && <p className={styles.meta}>A few things we need before {m.event.name}. They stay with the organizers; volunteers serving food see your allergy.</p>}

      <section aria-label="Profile setup" className={styles.card}>
        <form action={saveSetup} className={formStyles.form}>
          <input type="hidden" name="participantId" value={m.participantId} />
          <h2>Emergency contact</h2>
          <p className={styles.meta}>Who we call if something happens to you.</p>
          <label htmlFor="emergencyName">Emergency contact name</label>
          <input id="emergencyName" name="emergencyName" required maxLength={100} autoComplete="off" defaultValue={m.emergency?.name ?? ''} className={formStyles.input} />
          <label htmlFor="emergencyPhone">Emergency contact phone</label>
          <input
            id="emergencyPhone"
            name="emergencyPhone"
            type="tel"
            required
            maxLength={30}
            pattern={PHONE_PATTERN}
            title="A phone number: digits, spaces and + ( ) - ."
            autoComplete="off"
            defaultValue={m.emergency?.phone ?? ''}
            className={formStyles.input}
          />
          <label htmlFor="emergencyRelation">Relationship (optional)</label>
          <input
            id="emergencyRelation"
            name="emergencyRelation"
            maxLength={60}
            placeholder="Parent, partner, friend…"
            autoComplete="off"
            defaultValue={m.emergency?.relation ?? ''}
            className={formStyles.input}
          />

          <h2>The event</h2>
          <fieldset className={me.choices}>
            <legend>Staying overnight?</legend>
            {OVERNIGHT.map(([value, label]) => (
              <label key={value} className={me.choice}>
                <input type="radio" name="overnight" value={value} required defaultChecked={m.overnight === value} />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset className={me.choices}>
            <legend>Your team</legend>
            {TEAM.map(([value, label]) => (
              <label key={value} className={me.choice}>
                <input type="radio" name="teamStatus" value={value} required defaultChecked={m.teamStatus === value} />
                {label}
              </label>
            ))}
          </fieldset>

          <h2>Health and access</h2>
          <AllergyFields allergies={m.allergies ?? ''} severity={m.allergySeverity ?? ''} inputClass={formStyles.input} hintClass={styles.meta} />
          <label htmlFor="accessibility">Accessibility needs (optional)</label>
          <textarea id="accessibility" name="accessibility" maxLength={500} placeholder="Anything that would make the event easier for you" defaultValue={m.accessibility ?? ''} className={me.textarea} />

          {error && !networkingError && (
            <p role="alert" className={formStyles.error}>
              {error}
            </p>
          )}
          {notices.saved === 'setup' && (
            <p role="status" className={formStyles.ok}>
              ✓ Saved. Your profile is set up.
            </p>
          )}
          <button type="submit">Save profile</button>
        </form>
      </section>

      <section aria-labelledby="networking" className={styles.card}>
        <h2 id="networking">Networking</h2>
        <div className={me.field}>
          <p className={me.label}>Name</p>
          <p className={styles.name}>{`${m.firstName} ${m.lastName}`.trim()}</p>
        </div>
        {m.badge ? <p className={me.chip}>✓ Badge linked.</p> : <p className={styles.meta}>No badge yet. Staff link badges at the check-in desk.</p>}
        <form action={saveNetworking} className={formStyles.form}>
          <input type="hidden" name="participantId" value={m.participantId} />
          <label htmlFor="linkedin">LinkedIn (optional)</label>
          <input
            id="linkedin"
            name="linkedin"
            inputMode="url"
            maxLength={200}
            pattern={LINKEDIN_PATTERN}
            title="Your LinkedIn profile link, like linkedin.com/in/yourname"
            autoComplete="url"
            placeholder="linkedin.com/in/yourname"
            defaultValue={m.linkedinUrl ?? ''}
            className={formStyles.input}
          />
          <label htmlFor="discord">Discord username (optional)</label>
          <input
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
            className={formStyles.input}
          />
          <label htmlFor="website">Website (optional)</label>
          <input
            id="website"
            name="website"
            inputMode="url"
            maxLength={200}
            pattern={WEBSITE_PATTERN}
            title="A website address, like yourname.dev"
            autoComplete="url"
            placeholder="yourname.dev"
            defaultValue={m.websiteUrl ?? ''}
            className={formStyles.input}
          />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" name="public" defaultChecked={m.profilePublic} style={{ width: 22, height: 22 }} />
            Show my name and these links to anyone who taps my badge
          </label>
          {networkingError && (
            <p role="alert" className={formStyles.error}>
              {error}
            </p>
          )}
          {notices.saved === '1' && (
            <p role="status" className={formStyles.ok}>
              ✓ Saved.
            </p>
          )}
          <button type="submit">Save links</button>
        </form>
      </section>
    </main>
  );
}
