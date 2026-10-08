'use client';

import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { QR_OPTIONS } from '@/lib/qr/options';
import styles from './staff-dialog.module.css';

interface Issued {
  url: string;
  expiresAt: string;
}

// PLAN F18 "Lost access to email": a 2-minute, single-use sign-in code shown as a QR of
// ME_ORIGIN/signin#<code>. Used from the admin participant drawer and the badge page's staff panel.
export function SigninCodeDialog(props: { participantId: string; name: string; onClose: () => void }) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const canvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const { participantId, onClose } = props;

  const issue = useCallback(async () => {
    setError(null);
    setIssued(null);
    const res = await fetch(`/api/participants/${participantId}/signin-code`, { method: 'POST' }).catch(() => null);
    if (res?.ok) setIssued((await res.json()) as Issued);
    else if (res?.status === 409) setError('Only accepted participants can sign in.');
    else if (res?.status === 401) setError('Your session expired. Sign in again.');
    else setError('Couldn’t make a code. Try again.');
  }, [participantId]);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    const t = setTimeout(() => void issue(), 0); // one code when the dialog opens
    return () => {
      clearTimeout(t);
      d?.close();
    };
  }, [issue]);

  useEffect(() => {
    if (issued && canvas.current) void QRCode.toCanvas(canvas.current, issued.url, { ...QR_OPTIONS, width: 280 });
  }, [issued]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = issued ? Math.max(0, Math.ceil((new Date(issued.expiresAt).getTime() - now) / 1000)) : 0;
  const expired = issued !== null && secondsLeft === 0;

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label={`Sign-in code for ${props.name}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2>Sign-in code for {props.name}</h2>
      <p>Let them scan this with their phone camera. Check it’s really them first.</p>
      {error && (
        <p className={styles.bad} role="alert">
          ✕ {error}
        </p>
      )}
      {issued && !expired && (
        <>
          <canvas ref={canvas} className={styles.qr} role="img" aria-label="Sign-in QR code" data-testid="signin-qr" data-url={issued.url} />
          <p role="timer" aria-live="off" className={styles.timer}>
            Valid for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} · works once
          </p>
        </>
      )}
      {expired && <p role="status">Expired: make a new one.</p>}
      <div className={styles.actions}>
        {(expired || error) && (
          <button type="button" className={styles.secondary} onClick={() => void issue()}>
            Make a new code
          </button>
        )}
        <button type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
