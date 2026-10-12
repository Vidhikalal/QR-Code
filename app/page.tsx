import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './landing.module.css';

export const metadata: Metadata = { title: 'Passline' };

// The front door on the ADMIN host (and the single dev host). The ME host answers 404 here (I-23):
// attendees arrive through the links in their emails, not this page.
export default function HomePage() {
  return (
    <main className={styles.page}>
      <h1>Passline</h1>
      <p className={styles.lead}>Event passes, NFC badges and check-in for the club’s events.</p>
      <section className={styles.card} aria-labelledby="staff-heading">
        <h2 id="staff-heading">Admins, organizers and volunteers</h2>
        <p>Create events and checkpoints, run the door and scan badges.</p>
        <Link className="button" href="/login?next=%2Fadmin">
          Sign in
        </Link>
      </section>
      <section className={styles.card} aria-labelledby="attendee-heading">
        <h2 id="attendee-heading">Attendees</h2>
        <p>
          Open <strong>Set up your profile</strong> in your acceptance email. Lost it? <Link href="/signin">Get a new link</Link>.
        </p>
      </section>
    </main>
  );
}
