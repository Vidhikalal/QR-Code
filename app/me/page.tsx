import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db/server';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { env } from '@/lib/env';
import { myPasses } from '@/lib/pass/mine';
import styles from '../profile/[uid]/profile.module.css';
import { loadMe, menuMetadata } from './load';
import me from './me.module.css';

export const metadata: Metadata = menuMetadata('Menu');

// SPEC F14 (v0.6.1): the hacker menu for your event (tapping your own badge opens it), and links for staff
// (v0.4.1). The pass link carries the token only in the fragment (I-3), and the page never sends a referrer.
export default async function MePage() {
  const { user, me: m } = await loadMe('/me');
  const pass = m ? (await myPasses(db(), user.email ?? '', env().PASS_TOKEN_SECRET, new Date())).find((p) => p.participantId === m.participantId)?.pass : undefined;
  // v0.4.1: staff get links to their events (the admin and scanner pages check the role again).
  const { data: roles, error } = await db()
    .from('event_staff')
    .select('role, events!inner(slug, name, starts_at)')
    .eq('user_id', user.id)
    .order('starts_at', { referencedTable: 'events', ascending: false });
  if (error) throw new Error(`event_staff lookup failed (${error.code})`);

  return (
    <main className={styles.page}>
      {m ? (
        <>
          <p className={styles.eyebrow}>
            {formatEventDateTime(m.event.startsAt, m.event.timezone)} · {m.event.venue}
          </p>
          <h1>{m.event.name}</h1>
          <p>Hi {m.firstName}.</p>
          <nav aria-label="Hacker menu">
            <ul className={me.menu}>
              <li>
                <Link className={me.item} href="/me/profile">
                  Hacker profile
                </Link>
              </li>
              <li>
                <Link className={me.item} href="/me/team">
                  Team
                </Link>
              </li>
              <li>
                <Link className={me.item} href="/me/schedule">
                  Schedule
                </Link>
              </li>
              <li>
                <Link className={me.item} href="/me/emergency">
                  Emergency contact
                </Link>
              </li>
              <li>
                {typeof pass === 'object' ? (
                  // A plain link: the token is in the fragment (I-3), which client navigation must not touch.
                  <a className={me.item} href={`/p#${pass.token}`}>
                    My pass
                  </a>
                ) : (
                  <p className={me.item}>
                    My pass
                    <small>{pass === 'in_email' ? 'In your email' : pass === 'on_its_way' ? 'On its way by email' : 'The event is over'}</small>
                  </p>
                )}
              </li>
            </ul>
          </nav>
        </>
      ) : (
        <h1>My events</h1>
      )}
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
      {!m && roles.length === 0 && <p>No upcoming events yet. When you answer Yes to an invitation, your event shows up here.</p>}
      <p style={{ marginTop: 24 }}>Signed in as {user.email}.</p>
      <form action="/auth/signout" method="post" style={{ marginTop: 12 }}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
