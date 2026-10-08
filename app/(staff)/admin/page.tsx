import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { eventHome, isPlatformAdmin, listEventsFor } from '@/lib/events/queries';
import styles from './[slug]/admin.module.css';
import { JoinButton } from './join-button';

export const metadata: Metadata = { title: 'Events · Passline', robots: { index: false } };

// PLAN §10.3: where staff land after sign-in. Admins see every event; others see the ones they staff.
export default async function EventsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/admin');
  const [events, admin] = await Promise.all([listEventsFor(db(), user.id), isPlatformAdmin(db(), user.id)]);
  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <div className={styles.toolbar}>
          <h1>Events</h1>
          {admin && (
            <Link href="/admin/new" className={styles.linkButton + ' ' + styles.small}>
              + New event
            </Link>
          )}
        </div>
        {events.length === 0 ? (
          <p className={styles.muted}>
            {admin ? 'No events yet. Create the first one.' : 'You aren’t staff on any event yet. Ask an organizer to invite this email address.'}
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Starts</th>
                  <th>Ends</th>
                  <th>Your role</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{e.myRole ? <Link href={eventHome(e)}>{e.name}</Link> : e.name}</td>
                    <td>{formatEventDateTime(e.startsAt, e.timezone)}</td>
                    <td>{formatEventDateTime(e.endsAt, e.timezone)}</td>
                    <td>{e.myRole ?? <JoinButton eventId={e.id} eventName={e.name} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form action="/auth/signout" method="post">
          <button type="submit" className={styles.secondary + ' ' + styles.small}>
            Sign out
          </button>
        </form>
      </main>
    </div>
  );
}
