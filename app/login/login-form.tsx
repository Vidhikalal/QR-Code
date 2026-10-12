'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import styles from './login.module.css';

type State = 'idle' | 'sending' | 'sent' | 'verifying';

async function post(url: string, body: unknown): Promise<{ status: number; data: { code?: string; next?: string; error?: string } }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  return { status: res?.status ?? 0, data: res ? ((await res.json().catch(() => ({}))) as { code?: string; next?: string }) : {} };
}

// SPEC F9. The server emails a sign-in link and a 6-digit code: open the link on this device, or type
// the code (e.g. on a phone, where the link would open somewhere else). The browser never calls Supabase.
// `passwordLogin` (FEATURE_PASSWORD_LOGIN, dev only): also offer email + password, e.g. the local admin.
export function LoginForm({ next, passwordLogin = false }: { next: string; passwordLogin?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<State>('idle');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  async function signInWithPassword() {
    setError(null);
    setState('sending');
    const r = await post('/auth/password', { email, password, next });
    if (r.status === 200 && r.data.next) return router.replace(r.data.next);
    setState('idle');
    setError(r.status === 429 ? 'Too many tries. Wait 15 minutes, or use the email link.' : 'Wrong email or password.');
  }

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState('sending');
    const r = await post('/auth/send-code', { email, next });
    if (r.status === 200) return setState('sent');
    setState('idle');
    setError(r.status === 429 ? 'Too many emails to this address. Wait a minute, then try again.' : r.status === 400 ? 'Check the email address.' : 'Couldn’t send the email. Wait a moment and try again.');
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState('verifying');
    const r = await post('/auth/verify-code', { email, code: code.trim(), next });
    if (r.status === 200 && r.data.next) return router.replace(r.data.next);
    setState('sent');
    setError(r.status === 429 ? 'Too many tries. Wait 15 minutes or use the link in the email.' : 'That code didn’t work. Check it, or use the newest email.');
  }

  if (state === 'sent' || state === 'verifying') {
    return (
      <form className={styles.form} onSubmit={verify}>
        <p role="status" className={styles.ok}>
          ✓ Check your email for a sign-in link. On another device, enter the 6-digit code from the email instead.
        </p>
        <label htmlFor="code">6-digit code</label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          className={styles.input}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <button type="submit" disabled={state === 'verifying' || code.length !== 6}>
          {state === 'verifying' ? 'Signing in…' : 'Sign in'}
        </button>
        {error && (
          <p role="alert" className={styles.error}>
            ✕ {error}
          </p>
        )}
        <button type="button" className={styles.secondary} onClick={() => (setState('idle'), setCode(''), setError(null))}>
          Use a different email
        </button>
      </form>
    );
  }
  return (
    <form className={styles.form} onSubmit={send}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" required className={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} />
      {passwordLogin && (
        <>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" className={styles.input} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" disabled={state === 'sending' || !email || !password} onClick={() => void signInWithPassword()}>
            Sign in
          </button>
          <p className={styles.or}>or, without a password:</p>
        </>
      )}
      <button type="submit" disabled={state === 'sending'} className={passwordLogin ? styles.secondary : undefined}>
        {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          ✕ {error}
        </p>
      )}
    </form>
  );
}
