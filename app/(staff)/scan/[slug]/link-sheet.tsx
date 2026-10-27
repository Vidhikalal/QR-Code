'use client';

import { useEffect, useRef } from 'react';
import type { linkNotice } from '@/lib/domain/badge';
import type { NfcState } from '@/lib/scanner/nfc';
import styles from './scanner.module.css';

export type LinkState = { kind: 'waiting'; unreadable?: boolean } | { kind: 'saving' } | { kind: 'result'; notice: ReturnType<typeof linkNotice> };

export function LinkSheet(props: {
  name: string;
  state: LinkState;
  readerState: NfcState;
  readerError: string | null;
  onStart: () => void;
  onClose: () => void;
}) {
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
      aria-labelledby="link-title"
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      // Chrome closes the dialog itself on a second Back/Escape. Ignore a queued close event from our own
      // effect cleanup (React runs effects twice in development) that finds the dialog open again.
      onClose={() => {
        if (!ref.current?.open) props.onClose();
      }}
    >
      <h2 id="link-title">Link a badge</h2>
      <p>Tap the badge to link it to {props.name}.</p>
      <div aria-live="polite" aria-atomic="true">
        {props.state.kind === 'waiting' && props.state.unreadable && <p>Couldn’t read that badge. Hold it still and tap again.</p>}
        {props.state.kind === 'saving' && <p>Linking badge…</p>}
        {props.state.kind === 'result' && <p className={styles.linkNotice} data-tone={props.state.notice.tone}>{props.state.notice.text}</p>}
        {props.state.kind === 'waiting' && props.readerError && <p className={styles.linkNotice} data-tone="bad">✕ {props.readerError}</p>}
        {props.state.kind === 'waiting' && props.readerState === 'starting' && <p>Starting badge reader…</p>}
      </div>
      <div className={styles.dialogActions}>
        {props.state.kind === 'waiting' && props.readerState === 'off' && (
          <button type="button" className={styles.secondary} onClick={props.onStart}>
            Start badge reader
          </button>
        )}
        <button type="button" className={styles.secondary} onClick={props.onClose} autoFocus>
          {props.state.kind === 'result' ? 'Done' : 'Cancel'}
        </button>
      </div>
    </dialog>
  );
}
