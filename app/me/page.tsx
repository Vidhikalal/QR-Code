import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { env } from '@/lib/env';
import { myBadgeProfiles, saveBadgeProfile } from '@/lib/me/profile';
import { myPasses } from '@/lib/pass/mine';
import formStyles from '../login/login.module.css';
import styles from '../profile/[uid]/profile.module.css';

// SPEC §6.1/F13 (v0.4): a signed-in attendee's passes. The link carries the token only in the fragment
// (I-3), and the page never sends a referrer.
export const metadata: Metadata = {
  title: 'My passes · Passline',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

// v0.5: the attendee's own LinkedIn and badge sharing, per event (§6.5). Only their own row changes.
async function saveProfile(formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login?next=/me');
  const id = String(formData.get('participantId') ?? '');
  const result = await saveBadgeProfile(db(), user, id, {
    linkedin: String(formData.get('linkedin') ?? ''),
    profilePublic: formData.get('public') === 'on',
  });
  const status = result === 'SAVED' ? 'saved' : result === 'INVALID_LINKEDIN' ? 'invalid' : 'refused';
  redirect(`/me?${status}=${encodeURIComponent(id)}#badge-profile`);
}

type Notices = { badge?: string; saved?: string; invalid?: string; refused?: string };

export default async function MyPassesPage({ searchParams }: { searchParams: Promise<Notices> }) {
  await connection(); // per request: a new or revoked pass shows on the next visit
  const user = await currentUser();
  if (!user) redirect('/login?next=/me');
  const notices = await searchParams;
  const now = new Date();
  const passes = await myPasses(db(), user.email ?? '', env().PASS_TOKEN_SECRET, now);
  const profiles = await myBadgeProfiles(db(), user.email ?? '', now);
  // v0.4.1: staff get links to their events (the admin and scanner pages check the role again).
  const { data: roles, error } = await db()
    .from('event_staff')
    .select('role, events!inner(slug, name, starts_at)')
    .eq('user_id', user.id)
    .order('starts_at', { referencedTable: 'events', ascending: false });
  if (error) throw new Error(`event_staff lookup failed (${error.code})`);

  return (
    <main className={styles.page}>
      <h1>My passes</h1>
      <p>Signed in as {user.email}.</p>
      {roles.length > 0 && (
        <section aria-labelledby="staff-heading" style={{ marginTop: 16 }}>
          <h2 id="staff-heading">Staff</h2>
          {roles.map(({ role, events: e }) => (
            <div key={e.slug} className={styles.card} style={{ marginTop: 12 }}>
              <p className={styles.eyebrow}>{role === 'organizer' ? 'Organizer' : 'Volunteer'}</p>
              <h3>{e.name}</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {role === 'organizer' && (
                  <a className={styles.link} href={`/admin/${e.slug}`} aria-label={`Admin: ${e.name}`}>
                    Admin
                  </a>
                )}
                <a className={styles.link} href={`/scan/${e.slug}`} aria-label={`Scanner: ${e.name}`}>
                  Scanner
                </a>
              </div>
            </div>
          ))}
        </section>
      )}
      {passes.length === 0 && roles.length === 0 && profiles.length === 0 && <p>No upcoming events yet. When you answer Yes to an invitation, your pass shows up here.</p>}
      {passes.map((p) => (
        <section key={p.participantId} className={styles.card} style={{ marginTop: 16 }}>
          <p className={styles.eyebrow}>
            {formatEventDateTime(p.event.startsAt, p.event.timezone)} · {p.event.venue}
          </p>
          <h2>{p.event.name}</h2>
          {typeof p.pass === 'object' ? (
            <a className={styles.link} href={`/p#${p.pass.token}`}>
              Open my pass
            </a>
          ) : p.pass === 'in_email' ? (
            <p>Your pass is in your email.</p>
          ) : (
            <p>Your pass is on its way. We&apos;re also emailing it to you.</p>
          )}
        </section>
      ))}
      {profiles.length > 0 && (
        <section id="badge-profile" aria-labelledby="badge-heading" style={{ marginTop: 24 }}>
          <h2 id="badge-heading">Badge profile</h2>
          {notices.badge === 'linked' && (
            <p role="status" className={formStyles.ok}>
              ✓ Badge linked. Add your LinkedIn and choose whether to share it.
            </p>
          )}
          {profiles.map((b) => (
            <div key={b.participantId} className={styles.card} style={{ marginTop: 12 }}>
              <p className={styles.eyebrow}>{b.eventName}</p>
              <p>{b.badge ? '✓ Badge linked.' : 'No badge yet. Tap your badge with your phone to link it to you.'}</p>
              <form action={saveProfile} className={formStyles.form}>
                <input type="hidden" name="participantId" value={b.participantId} />
                <label htmlFor={`linkedin-${b.participantId}`}>LinkedIn</label>
                <input
                  id={`linkedin-${b.participantId}`}
                  name="linkedin"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="linkedin.com/in/yourname"
                  defaultValue={b.linkedinUrl ?? ''}
                  className={formStyles.input}
                />
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
                  <input type="checkbox" name="public" defaultChecked={b.profilePublic} style={{ width: 22, height: 22 }} />
                  Show my name and LinkedIn when someone at the event taps my badge
                </label>
                {notices.invalid === b.participantId && (
                  <p role="alert" className={formStyles.error}>
                    ✕ Not saved. Use your LinkedIn profile link, like linkedin.com/in/yourname.
                  </p>
                )}
                {notices.refused === b.participantId && (
                  <p role="alert" className={formStyles.error}>
                    ✕ Not saved. Reload the page and try again.
                  </p>
                )}
                {notices.saved === b.participantId && (
                  <p role="status" className={formStyles.ok}>
                    ✓ Saved.
                  </p>
                )}
                <button type="submit">Save</button>
              </form>
            </div>
          ))}
        </section>
      )}
      <form action="/auth/signout" method="post" style={{ marginTop: 24 }}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
