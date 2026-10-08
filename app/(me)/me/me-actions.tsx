'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import styles from '../me.module.css';

// PLAN F18: sign out this device; "Get a new link" signs out everywhere and emails a fresh link.
export function MeActions() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function call(url: string, method: string): Promise<boolean> {
    const res = await fetch(url, { method }).catch(() => null);
    if (res?.ok || res?.status === 401) return true;
    setMessage('✕ Something went wrong. Try again.');
    return false;
  }

  async function signOut() {
    if (await call('/api/me/session', 'DELETE')) router.refresh();
  }

  async function rotate() {
    setConfirming(false);
    if (await call('/api/me/rotate', 'POST')) {
      setMessage('✓ Done. Every device is signed out. Check your email for your new link.');
      setTimeout(() => router.refresh(), 2500);
    }
  }

  return (
    <>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={() => void signOut()}>
          Sign out
        </button>
        <button type="button" className={styles.secondary} onClick={() => setConfirming(true)}>
          Get a new link
        </button>
      </div>
      {message && (
        <p role="status" className={`${styles.alert} ${message.startsWith('✓') ? styles.alertOk : styles.alertBad}`}>
          {message}
        </p>
      )}
      {confirming && <ConfirmRotate onConfirm={() => void rotate()} onCancel={() => setConfirming(false)} />}
    </>
  );
}

function ConfirmRotate({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label="Get a new link?"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2>Get a new link?</h2>
      <p>This signs out every device, including this one. Your old links stop working, and we’ll email you a new one.</p>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={styles.danger} onClick={onConfirm}>
          Get a new link
        </button>
      </div>
    </dialog>
  );
}
