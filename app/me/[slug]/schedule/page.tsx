import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../../../profile/[uid]/profile.module.css';
import me from '../../me.module.css';
import { loadMyEvent, menuMetadata } from '../load';

export const metadata: Metadata = menuMetadata('Schedule');

// SPEC F14: the schedule organizers type on the admin Info page (plain text, rendered escaped).
export default async function SchedulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { me: m } = await loadMyEvent(slug, `/me/${slug}/schedule`);
  return (
    <main className={styles.page}>
      <Link className={me.back} href={`/me/${m.slug}`}>
        ← Menu
      </Link>
      <p className={styles.eyebrow}>{m.event.name}</p>
      <h1>Schedule</h1>
      <section className={styles.card} style={{ marginTop: 16 }}>
        <p className={me.text}>{m.event.schedule || 'The organizers haven’t posted the schedule yet.'}</p>
      </section>
    </main>
  );
}
