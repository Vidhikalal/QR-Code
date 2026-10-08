'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import styles from '../me.module.css';

type CodeState = 'none' | 'working' | 'invalid' | 'rate_limited' | 'error';

// Two ways in (PLAN §10.4): a #code from a staff member's QR is redeemed automatically (the fragment is
// stripped first, I-18); otherwise "Email me a link".
export function SigninView({ events }: { events: Array<{ slug: string; name: string }> }) {
  const router = useRouter();
  const [codeState, setCodeState] = useState<CodeState>('working');
  const [eventSlug, setEventSlug] = useState(events.length === 1 ? (events[0]?.slug ?? '') : '');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // a code is single-use: redeem it once even if effects run twice
    started.current = true;
    const code = window.location.hash.replace(/^#/, '').trim();
    if (code) window.history.replaceState(null, '', '/signin');
    void (async () => {
      if (!code) return setCodeState('none');
      const res = await fetch('/api/me/session/code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      }).catch(() => null);
      if (!res) return setCodeState('error');
      if (res.status === 429) return setCodeState('rate_limited');
      const data = (await res.json().catch(() => ({}))) as { code?: string; next?: string };
      if (data.code === 'OPENED') return router.replace(data.next ?? '/me');
      setCodeState(data.code === 'CODE_INVALID' ? 'invalid' : 'error');
    })();
  }, [router]);

  async function requestLink() {
    setError(null);
    const res = await fetch('/api/signin/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventSlug, email }),
    }).catch(() => null);
    if (res?.ok) setSent(events.find((e) => e.slug === eventSlug)?.name ?? 'the event');
    else if (res?.status === 429) setError('Too many requests. Try again in an hour, or ask a staff member at the event.');
    else if (res?.status === 400) setError('Enter the email address you applied with.');
    else setError('Something went wrong. Check your connection and try again.');
  }

  if (codeState === 'working') {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <p role="status">Signing you in…</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      {codeState !== 'none' && (
        <p role="alert" className={`${styles.alert} ${styles.alertBad}`}>
          ✕{' '}
          {codeState === 'invalid'
            ? 'This code expired or was already used. Ask a staff member for a new one.'
            : codeState === 'rate_limited'
              ? 'Too many tries. Wait a minute and try again.'
              : 'Something went wrong. Ask a staff member for a new code.'}
        </p>
      )}
      <div className={styles.card}>
        <h1>Email me a link</h1>
        {sent ? (
          <p role="status" className={`${styles.alert} ${styles.alertOk}`}>
            ✓ If that email is registered for {sent}, we’ve sent a link. Check your inbox and spam.
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void requestLink();
            }}
          >
            <p className={styles.muted}>We’ll send a new sign-in link to the address you applied with.</p>
            <label className={styles.field}>
              Event
              <select className={styles.input} required value={eventSlug} onChange={(e) => setEventSlug(e.target.value)}>
                <option value="" disabled>
                  Choose your event
                </option>
                {events.map((e) => (
                  <option key={e.slug} value={e.slug}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Email
              <input className={styles.input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {error && (
              <p role="alert" className={`${styles.alert} ${styles.alertBad}`}>
                ✕ {error}
              </p>
            )}
            <div className={styles.actions}>
              <button type="submit">Email me a link</button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
