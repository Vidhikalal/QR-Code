'use client';

import Link from 'next/link';
import { useRef, useState, useSyncExternalStore } from 'react';
import { parseTagUrl } from '@/lib/badge/tags';
import { createNfcReader, isWebNfcSupported, NfcWriteError, type NfcError, type NfcReader, type NfcTap } from '@/lib/nfc/web-nfc';
import styles from '../../admin.module.css';
import { adminUrl } from '../../api';

const subscribeNever = () => () => undefined;
type Toast = { tone: 'ok' | 'warn' | 'bad'; text: string };

// PLAN F19 A: register blank badges with an Android phone. Per tap: if it already carries our URL,
// confirm it; otherwise the server mints an id (reserve), this phone writes the URL, then confirms the
// chip serial. Organizers protect the tags with NFC Tools afterwards (D5); this page never locks a tag.
export function Register({ slug }: { slug: string }) {
  const supported = useSyncExternalStore(subscribeNever, isWebNfcSupported, () => false);
  const [state, setState] = useState<'idle' | 'on' | NfcError>('idle');
  const [count, setCount] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const reader = useRef<NfcReader | null>(null);
  const working = useRef(false);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  async function post<T>(path: string, body: unknown): Promise<{ status: number; data: T | null }> {
    const res = await fetch(adminUrl(slug, path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    return { status: res?.status ?? 0, data: res ? ((await res.json().catch(() => null)) as T | null) : null };
  }

  async function onTap(tap: NfcTap) {
    if (working.current) return; // one badge at a time
    working.current = true;
    try {
      const existing = tap.url ? parseTagUrl(tap.url, process.env.NEXT_PUBLIC_APP_ORIGIN ?? origin) : { ok: false as const };
      if (existing.ok) {
        if (tap.uid) await post('/tags/confirm', { publicId: existing.publicId, uid: tap.uid });
        setToast({ tone: 'warn', text: '! Already registered. Tap the next badge.' });
        return;
      }
      const reserved = await post<{ publicId: string; label: string; url: string }>('/tags/reserve', {});
      if (!reserved.data?.publicId) {
        setToast({ tone: 'bad', text: `✕ Couldn’t reserve a badge id (${reserved.status}). Check your connection.` });
        return;
      }
      try {
        await reader.current?.write(reserved.data.url);
      } catch (err) {
        const kind = err instanceof NfcWriteError ? err.kind : 'write-failed';
        setToast({ tone: 'bad', text: kind === 'permission-denied' ? '✕ NFC permission was refused.' : '✕ Hold the badge still and tap again. (It may already be password-protected.)' });
        return;
      }
      if (!tap.uid) {
        setToast({ tone: 'warn', text: `! ${reserved.data.label} written, but this phone can’t read the chip serial.` });
        return;
      }
      const confirmed = await post<{ code: string }>('/tags/confirm', { publicId: reserved.data.publicId, uid: tap.uid });
      if (confirmed.data?.code === 'REGISTERED') {
        setCount((c) => c + 1);
        setToast({ tone: 'ok', text: `✓ ${reserved.data.label} registered` });
      } else setToast({ tone: 'bad', text: `✕ ${reserved.data.label}: ${confirmed.data?.code ?? confirmed.status}` });
    } finally {
      working.current = false;
    }
  }

  async function start() {
    reader.current ??= createNfcReader();
    setState('on');
    await reader.current.start(
      (tap) => void onTap(tap),
      (e) => setState(e),
    );
  }

  return (
    <>
      <h1>Register badges</h1>
      {!supported ? (
        <p className={`${styles.alert} ${styles.alertWarn}`} role="status">
          ! Use Chrome on an Android phone, over HTTPS, to write badges. <Link href={`/admin/${slug}/badges`}>Back to Badges</Link>
        </p>
      ) : (
        <>
          <p>Press Start, then hold each blank badge to the back of the phone until it says “registered”.</p>
          <div className={styles.toolbar}>
            {state !== 'on' && (
              <button type="button" onClick={() => void start()}>
                Start
              </button>
            )}
            <div className={styles.tile} data-testid="registered-count">
              <span className={styles.tileLabel}>Registered on this phone</span>
              <span className={styles.tileValue}>{count}</span>
            </div>
          </div>
          {state === 'on' && <p aria-live="polite">📶 Ready: tap a blank badge</p>}
          {state !== 'on' && state !== 'idle' && <p className={`${styles.alert} ${styles.alertWarn}`}>! NFC stopped ({state}). Press Start again.</p>}
        </>
      )}
      {toast && (
        <p role="status" className={`${styles.alert} ${toast.tone === 'ok' ? styles.alertOk : toast.tone === 'warn' ? styles.alertWarn : styles.alertBad}`}>
          {toast.text}
        </p>
      )}
      <p className={styles.muted}>Afterwards, set the event’s shared password on every badge with NFC Tools (Settings → badge unlock password).</p>
    </>
  );
}
