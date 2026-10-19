import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { env } from '@/lib/env';
import { myPasses } from '@/lib/pass/mine';
import styles from '../profile/[uid]/profile.module.css';

// SPEC §6.1/F13 (v0.4): a signed-in attendee's passes. The link carries the token only in the fragment
// (I-3), and the page never sends a referrer.
export const metadata: Metadata = {
  title: 'My passes · Passline',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function MyPassesPage() {
  await connection(); // per request: a new or revoked pass shows on the next visit
  const user = await currentUser();
  if (!user) redirect('/login?next=/me');
  const passes = await myPasses(db(), user.email ?? '', env().PASS_TOKEN_SECRET, new Date());
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
      {passes.length === 0 && roles.length === 0 && <p>No upcoming events yet. When you answer Yes to an invitation, your pass shows up here.</p>}
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
      <form action="/auth/signout" method="post" style={{ marginTop: 24 }}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
