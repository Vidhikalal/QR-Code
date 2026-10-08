import type { Metadata } from 'next';
import { forbidden, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { isPlatformAdmin } from '@/lib/events/queries';
import styles from '../[slug]/admin.module.css';
import { NewEventForm } from './new-event-form';

export const metadata: Metadata = { title: 'New event · Passline', robots: { index: false } };

// PLAN F14 step 1. Platform admins only (403 otherwise); the API re-checks on its own. The zone list
// comes from the server so server and client render the same options.
export default async function NewEventPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/admin/new');
  if (!(await isPlatformAdmin(db(), user.id))) forbidden();
  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <h1>New event</h1>
        <NewEventForm timeZones={Intl.supportedValuesOf('timeZone')} />
      </main>
    </div>
  );
}
