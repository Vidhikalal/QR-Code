import type { Metadata } from 'next';
import { safeNextPath } from '@/lib/auth/next-path';
import { LoginForm } from './login-form';
import styles from './login.module.css';

export const metadata: Metadata = { title: 'Sign in · Passline', robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const target = safeNextPath(next, '/');
  // Someone who tapped an attendee's badge (SPEC §6.5) is an attendee, not staff.
  const badge = target.startsWith('/profile/');
  return (
    <main className={styles.page}>
      <h1>{badge ? 'Sign in to see this badge' : 'Staff sign-in'}</h1>
      <p>
        {badge
          ? "We'll email you a sign-in link. Use the email you registered for the event with."
          : "We'll email you a sign-in link. Use the address your organizer invited."}
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          ✕ That sign-in link didn&apos;t work or has expired. Request a new one.
        </p>
      )}
      <LoginForm next={target} />
    </main>
  );
}
