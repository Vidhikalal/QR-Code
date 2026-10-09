'use client';

import Image from 'next/image';
import type { ResultView } from '@/lib/scanner/result-view';
import styles from './scanner.module.css';

export interface ResultChoice {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

// SPEC §10.2: icon + text + colour together; names ≥ 32 px, photo ≥ 160 px. Only green (and the
// "Not a Passline code" notice) auto-dismiss; every problem needs a tap so the volunteer notices it.
// With `choices` (e.g. "Replace it" / "Cancel", PLAN §10.2) the screen asks instead of dismissing on tap.
export function ResultScreen({ view, shownAt, onDismiss, choices }: { view: ResultView; shownAt: number; onDismiss: () => void; choices?: ResultChoice[] }) {
  const tap = view.dismiss === 'tap';
  const body = (
    <>
      <span className={styles.resultIcon} aria-hidden="true">
        {view.icon}
      </span>
      <span role="status" aria-live="assertive">
        <strong className={styles.resultHeadline}>{view.headline}</strong>
      </span>
      {view.photoUrl && <Image className={styles.resultPhoto} src={view.photoUrl} alt="" width={180} height={180} unoptimized />}
      {view.name && <span className={styles.resultName}>{view.name}</span>}
      {view.emphasis && <span className={styles.resultEmphasis}>{view.emphasis}</span>}
      {view.detail && <span className={styles.resultDetail}>{view.detail}</span>}
    </>
  );
  const common = { className: styles.result, 'data-tone': view.tone, 'data-testid': 'scan-result', 'data-shown-at': shownAt };
  if (choices && choices.length > 0) {
    return (
      <div {...common} data-dismiss="choice" role="alertdialog" aria-label={view.headline}>
        {body}
        <span className={styles.resultChoices}>
          {choices.map((c) => (
            <button key={c.label} type="button" className={c.danger ? styles.choiceDanger : styles.choice} onClick={c.onClick}>
              {c.label}
            </button>
          ))}
        </span>
      </div>
    );
  }
  return (
    <button type="button" {...common} data-dismiss={tap ? 'tap' : 'auto'} onClick={onDismiss} aria-describedby="result-hint">
      {body}
      <span id="result-hint" className={styles.resultHint}>
        {tap ? 'Tap to continue' : 'Tap to skip'}
      </span>
    </button>
  );
}
