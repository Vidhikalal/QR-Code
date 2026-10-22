'use client';

import { useActionState, useState } from 'react';
import { sendPasswordLink, signIn } from './actions';
import styles from './login.module.css';

export function LoginForm({ next }: { next: string }) {
  const [forgot, setForgot] = useState(false);
  // Kept here, not in the action state, so a failed sign-in doesn't clear it.
  const [email, setEmail] = useState('');
  const [signInState, signInAction, signingIn] = useActionState(signIn, null);
  const [linkState, linkAction, sending] = useActionState(sendPasswordLink, null);

  if (forgot && linkState && 'sent' in linkState) {
    return (
      <p role="status" className={styles.ok}>
        ✓ Check your email. If that address can use Passline, we sent a link to set your password.
      </p>
    );
  }
  if (forgot) {
    return (
      <form className={styles.form} action={linkAction}>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={styles.input} />
        <button type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Email me a link to set my password'}
        </button>
        <button type="button" className={styles.linkButton} onClick={() => setForgot(false)}>
          Back to sign-in
        </button>
      </form>
    );
  }
  return (
    <form className={styles.form} action={signInAction}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={styles.input} />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required className={styles.input} />
      {signInState && 'error' in signInState && (
        <p role="alert" className={styles.error}>
          ✕ Wrong email or password.
        </p>
      )}
      <button type="submit" disabled={signingIn}>
        {signingIn ? 'Signing in…' : 'Sign in'}
      </button>
      <button type="button" className={styles.linkButton} onClick={() => setForgot(true)}>
        Forgot or never set your password?
      </button>
    </form>
  );
}
