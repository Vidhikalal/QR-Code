'use client';

import { useEffect, useRef } from 'react';
import styles from './scanner.module.css';

// Badges are mandatory at the door (2026-10-11): leaving without one is a deliberate, confirmed choice.
export function NoBadgeDialog(props: { name: string; onConfirm: () => void; onCancel: () => void }) {
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
      aria-labelledby="no-badge-title"
      onCancel={(e) => {
        e.preventDefault();
        props.onCancel();
      }}
    >
      <h2 id="no-badge-title">Continue without a badge?</h2>
      <p>
        {props.name} can’t check in at meals or workshops until a badge is linked. To link one later, scan their pass at the Door again.
      </p>
      <div className={styles.choiceList}>
        <button type="button" className={styles.choice} onClick={props.onCancel}>
          Link a badge now
        </button>
        <button type="button" className={`${styles.choice} ${styles.secondary}`} onClick={props.onConfirm}>
          Continue without a badge
        </button>
      </div>
    </dialog>
  );
}
