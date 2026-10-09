'use client';

import { useState } from 'react';
import { connectCopy, type ConnectCode } from '@/lib/connections/copy';
import styles from './badge.module.css';

// PLAN F24: Connect. Counts only once both people have tapped each other's badge (record_connection).
export function ConnectButton(props: { publicId: string; name: string; state: 'none' | 'pending' | 'mutual' }) {
  const [status, setStatus] = useState(props.state);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    const res = await fetch('/api/me/connections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tagPublicId: props.publicId }) }).catch(() => null);
    setBusy(false);
    if (res?.status === 401) return setMessage({ ok: false, text: 'You’ve been signed out. Open your newest profile link to connect.' });
    if (res?.status === 429) return setMessage({ ok: false, text: 'That’s a lot of connections! Try again in a while.' });
    const data = (await res?.json().catch(() => null)) as { code?: ConnectCode; otherName?: string | null } | null;
    if (!res?.ok || !data?.code) return setMessage({ ok: false, text: 'Couldn’t connect. Check your connection and try again.' });
    setMessage(connectCopy(data.code, data.otherName ?? props.name));
    if (data.code === 'MUTUAL' || data.code === 'ALREADY_MUTUAL') setStatus('mutual');
    else if (data.code === 'PENDING' || data.code === 'ALREADY_PENDING') setStatus('pending');
  }

  return (
    <div className={styles.card} aria-label="Connect">
      {status === 'mutual' ? (
        <p>✓ You’re connected with {props.name}.</p>
      ) : status === 'pending' ? (
        <p>⏳ Waiting for {props.name} to tap your badge back.</p>
      ) : (
        <button type="button" className={styles.big} disabled={busy} onClick={() => void connect()}>
          Connect with {props.name}
        </button>
      )}
      {message && (
        <p role="status" className={`${styles.alert} ${message.ok ? styles.alertOk : styles.alertBad}`}>
          {message.text}
        </p>
      )}
      <p className={styles.muted}>
        <a href="/me/connections">My connections</a>
      </p>
    </div>
  );
}
