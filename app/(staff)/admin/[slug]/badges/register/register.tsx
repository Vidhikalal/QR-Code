'use client';

import Link from 'next/link';
import { useRef, useState, useSyncExternalStore } from 'react';
import { parseTagUrl } from '@/lib/badge/tags';
import { createNfcReader, isWebNfcSupported, NfcWriteError, type NfcError, type NfcReader, type NfcTap } from '@/lib/nfc/web-nfc';
import styles from '../../admin.module.css';
import { adminUrl } from '../../api';

const subscribeNever = () => () => undefined;
type Toast = { tone: 'ok' | 'warn' | 'bad'; text: string };
type Reserved = { publicId: string; label: string; url: string };
const SLOW_WRITE_MS = 1500;

// PLAN F19 A: register blank badges with an Android phone. Per tap: if it already carries our URL,
// confirm it; otherwise the server mints an id (reserve), this phone writes the URL, then confirms the
// chip serial. Organizers protect the tags with NFC Tools afterwards (D5); this page never locks a tag.
//
// Timing (real phones): the next id is reserved BEFORE the tap (on Start, and after each badge), so the
// URL is written while the badge is still touching the phone. A server round trip between read and
// write lets the badge leave the field, and Chrome's write() then waits silently for the next tap.
export function Register({ slug }: { slug: string }) {
  const supported = useSyncExternalStore(subscribeNever, isWebNfcSupported, () => false);
  const [state, setState] = useState<'idle' | 'starting' | 'on' | NfcError>('idle');
  const [count, setCount] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const reader = useRef<NfcReader | null>(null);
  const working = useRef(false);
  const nextId = useRef<Promise<Reserved | null> | null>(null);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  async function post<T>(path: string, body: unknown): Promise<{ status: number; data: T | null }> {
    const res = await fetch(adminUrl(slug, path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    return { status: res?.status ?? 0, data: res ? ((await res.json().catch(() => null)) as T | null) : null };
  }

  function reserveNext() {
    nextId.current = post<Reserved>('/tags/reserve', {}).then((r) => (r.data?.publicId ? r.data : null));
  }

  async function onTap(tap: NfcTap) {
    if (working.current) return; // one badge at a time
    working.current = true;
    setToast({ tone: 'warn', text: 'Badge detected: keep holding it to the phone…' });
    try {
      const existing = tap.url ? parseTagUrl(tap.url, process.env.NEXT_PUBLIC_APP_ORIGIN ?? origin) : { ok: false as const };
      if (existing.ok) {
        if (tap.uid) await post('/tags/confirm', { publicId: existing.publicId, uid: tap.uid });
        setToast({ tone: 'warn', text: '! Already registered. Tap the next badge.' });
        return;
      }
      if (!nextId.current) reserveNext();
      const reserved = await nextId.current;
      if (!reserved) {
        reserveNext(); // try again for the next tap
        setToast({ tone: 'bad', text: '✕ Couldn’t reserve a badge id. Check your connection, then tap again.' });
        return;
      }
      // Chrome writes at once if the badge is still touching the phone; otherwise it waits for the next tap.
      const slow = setTimeout(() => setToast({ tone: 'warn', text: 'Hold the badge to the phone again to finish writing.' }), SLOW_WRITE_MS);
      try {
        await reader.current?.write(reserved.url);
      } catch (err) {
        const kind = err instanceof NfcWriteError ? err.kind : 'write-failed';
        setToast({ tone: 'bad', text: kind === 'permission-denied' ? '✕ NFC permission was refused.' : '✕ Hold the badge still and tap again. (It may already be password-protected.)' });
        return; // the reserved id stays unconfirmed and is reused for the next tap
      } finally {
        clearTimeout(slow);
      }
      nextId.current = null;
      reserveNext(); // ready before the next badge touches the phone
      if (!tap.uid) {
        setToast({ tone: 'warn', text: `! ${reserved.label} written, but this phone can’t read the chip serial.` });
        return;
      }
      const confirmed = await post<{ code: string }>('/tags/confirm', { publicId: reserved.publicId, uid: tap.uid });
      if (confirmed.data?.code === 'REGISTERED') {
        setCount((c) => c + 1);
        setToast({ tone: 'ok', text: `✓ ${reserved.label} registered` });
      } else setToast({ tone: 'bad', text: `✕ ${reserved.label}: ${confirmed.data?.code ?? confirmed.status}` });
    } finally {
      working.current = false;
    }
  }

  // "Ready" only once Chrome has actually started listening (scan() resolved), as on the scanner.
  async function start() {
    reader.current ??= createNfcReader();
    setState('starting');
    if (!nextId.current) reserveNext();
    await reader.current.start(
      (tap) => void onTap(tap),
      (e) => setState(e),
    );
    setState((s) => (s === 'starting' ? 'on' : s));
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
              <button type="button" disabled={state === 'starting'} onClick={() => void start()}>
                Start
              </button>
            )}
            <div className={styles.tile} data-testid="registered-count">
              <span className={styles.tileLabel}>Registered on this phone</span>
              <span className={styles.tileValue}>{count}</span>
            </div>
          </div>
          {state === 'starting' && <p aria-live="polite">Starting NFC… allow it if Chrome asks.</p>}
          {state === 'on' && <p aria-live="polite">📶 Ready: tap a blank badge</p>}
          {state === 'permission-denied' && (
            <p className={`${styles.alert} ${styles.alertWarn}`}>! NFC permission was refused. Allow NFC for this site in Chrome’s site settings, then press Start again.</p>
          )}
          {state !== 'on' && state !== 'idle' && state !== 'starting' && state !== 'permission-denied' && (
            <p className={`${styles.alert} ${styles.alertWarn}`}>! NFC stopped ({state}). Press Start again.</p>
          )}
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
