import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeNextPath } from '@/lib/auth/next-path';
import { landingAfterSignIn } from '@/lib/auth/onboarding';
import { currentUser, supabaseForRequest } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import styles from '../login/login.module.css';

export const metadata: Metadata = { title: 'Set your password · Passline', robots: { index: false } };

// 72: bcrypt ignores anything longer, and the auth server rejects it.
const passwordSchema = z.string().min(8).max(72);

// SPEC F9/F13 (v0.4): after an invite, reset or RSVP link, the signed-in person picks their password.
async function savePassword(formData: FormData) {
  'use server';
  const next = safeNextPath(String(formData.get('next') ?? ''), '/me');
  const retry = `/set-password?invalid=1&next=${encodeURIComponent(next)}`;
  const password = passwordSchema.safeParse(formData.get('password'));
  if (!password.success) redirect(retry);
  const { data, error } = await (await supabaseForRequest()).auth.updateUser({ password: password.data });
  if (error?.code === 'weak_password') redirect(retry);
  // Choosing the password you already have is fine (e.g. "Forgot password" when you hadn't).
  if (error && error.code !== 'same_password') {
    if (error.status === 401 || error.code === 'session_not_found') redirect(`/login?next=${encodeURIComponent(next)}`);
    throw new Error(`updateUser failed (${error.code ?? error.status})`);
  }
  const user = data.user ?? (await currentUser());
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  redirect(await landingAfterSignIn(db(), user, next));
}

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string; invalid?: string }> }) {
  const { next, invalid } = await searchParams;
  const target = safeNextPath(next, '/me');
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(target)}`);
  return (
    <main className={styles.page}>
      <h1>Set your password</h1>
      <p>You&apos;ll sign in to Passline with {user.email} and this password.</p>
      <form action={savePassword} className={styles.form}>
        <input type="hidden" name="next" value={target} />
        {/* Lets password managers save the new password against the right account. */}
        <input type="email" name="username" autoComplete="username" value={user.email ?? ''} readOnly hidden />
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className={styles.input} />
        {invalid && (
          <p role="alert" className={styles.error}>
            ✕ Use 8 to 72 characters.
          </p>
        )}
        <button type="submit">Save password</button>
      </form>
    </main>
  );
}
