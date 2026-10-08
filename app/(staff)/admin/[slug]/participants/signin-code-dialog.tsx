'use client';

import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { QR_OPTIONS } from '@/lib/qr/options';
import styles from '../admin.module.css';
import { errorText, useApi, useLoad } from '../api';
import { Modal } from '../dialog';

interface Issued {
  url: string;
  expiresAt: string;
}

// PLAN F18 "Lost access to email": a 2-minute, single-use sign-in code shown as a QR of
// ME_ORIGIN/signin#<code>. The participant scans it with their own phone camera.
export function SigninCodeDialog(props: { participantId: string; name: string; onClose: () => void }) {
  const api = useApi();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const canvas = useRef<HTMLCanvasElement>(null);

  const { participantId } = props;
  const issue = useCallback(async () => {
    setError(null);
    setIssued(null);
    const r = await api<Issued>(`/api/participants/${participantId}/signin-code`, { method: 'POST' });
    if (r.ok) setIssued(r.data);
    else setError(r.status === 409 ? 'Only accepted participants can sign in.' : errorText(r));
  }, [api, participantId]);

  useLoad(issue); // one code when the dialog opens

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
    <Modal title={`Sign-in code for ${props.name}`} onCancel={props.onClose}>
      <p>Let them scan this with their phone camera. Check it’s really them first.</p>
      {error && (
        <p className={styles.alert + ' ' + styles.alertBad} role="alert">
          ✕ {error}
        </p>
      )}
      {issued && !expired && (
        <>
          <canvas ref={canvas} role="img" aria-label="Sign-in QR code" data-testid="signin-qr" data-url={issued.url} style={{ display: 'block', margin: '0 auto', background: '#fff' }} />
          <p role="timer" aria-live="off" style={{ textAlign: 'center' }}>
            Valid for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} · works once
          </p>
        </>
      )}
      {expired && <p role="status">Expired: make a new one.</p>}
      <div className={styles.dialogActions}>
        {(expired || error) && (
          <button type="button" className={styles.secondary} onClick={() => void issue()}>
            Make a new code
          </button>
        )}
        <button type="button" onClick={props.onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
