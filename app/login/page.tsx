import type { Metadata } from 'next';
import { safeNextPath } from '@/lib/auth/next-path';
import { LoginForm } from './login-form';
import styles from './login.module.css';

export const metadata: Metadata = { title: 'Sign in · Passline', robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const target = safeNextPath(next, '/me');
  // Someone who tapped an attendee's badge (SPEC §6.5) is an attendee, not staff.
  const badge = target.startsWith('/profile/');
  return (
    <main className={styles.page}>
      <h1>{badge ? 'Sign in to link this badge' : target.startsWith('/scan/') || target.startsWith('/admin/') ? 'Staff sign-in' : 'Sign in'}</h1>
      <p>
        {badge
          ? 'Use the email you registered for the event with.'
          : 'Use the email and password you set from your Passline invitation.'}
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          ✕ That link didn&apos;t work or has expired. Use &quot;Forgot or never set your password?&quot; to get a new one.
        </p>
      )}
      <LoginForm next={target} />
    </main>
  );
}
