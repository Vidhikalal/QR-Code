'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import styles from '../me.module.css';

type State = 'working' | 'replaced' | 'invalid' | 'rate_limited' | 'error';

const MESSAGES: Record<Exclude<State, 'working'>, string> = {
  replaced: 'This link was replaced. Use the link in your newest email.',
  invalid: 'This link doesn’t work. Check that you opened the whole link from your email.',
  rate_limited: 'Too many tries. Wait a minute, then open the link again.',
  error: 'Something went wrong. Check your connection and open the link again.',
};

// Strips the key from the address bar and history FIRST, then exchanges it for a session cookie.
export function EditLink() {
  const router = useRouter();
  const [state, setState] = useState<State>('working');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // dev mode mounts effects twice; a key is exchanged once
    started.current = true;
    const key = window.location.hash.replace(/^#/, '').trim();
    window.history.replaceState(null, '', '/edit');
    void (async () => {
      if (!key) return setState('invalid');
      const res = await fetch('/api/me/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      }).catch(() => null);
      if (!res) return setState('error');
      if (res.status === 429) return setState('rate_limited');
      const data = (await res.json().catch(() => ({}))) as { code?: string; next?: string };
      if (data.code === 'OPENED') return router.replace(data.next ?? '/me');
      setState(data.code === 'KEY_REVOKED' ? 'replaced' : data.code === 'LINK_INVALID' ? 'invalid' : 'error');
    })();
  }, [router]);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        {state === 'working' ? (
          <p role="status">Signing you in…</p>
        ) : (
          <>
            <h1>Can’t sign you in</h1>
            <p role="alert" className={`${styles.alert} ${styles.alertBad}`}>
              ✕ {MESSAGES[state]}
            </p>
            <p className={styles.muted}>Lost the email? Ask an organizer at the event.</p>
          </>
        )}
      </div>
    </main>
  );
}
