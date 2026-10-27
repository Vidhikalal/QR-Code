'use client';

import { useState } from 'react';
import styles from './profile.module.css';

// SPEC §6.5 (v0.9.2): Discord has no public profile link for a username, so the badge page offers to copy it.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed'); // no clipboard (plain http, an old browser): the name is still on screen to select
    }
  }
  return (
    <>
      <button type="button" className={styles.copy} onClick={copy} aria-label={label}>
        {state === 'copied' ? '✓ Copied' : 'Copy'}
      </button>
      {/* Always rendered, so screen readers announce each change; only the failure needs to be seen. */}
      <span role="status" className={state === 'failed' ? styles.copyNote : 'visually-hidden'}>
        {state === 'copied' ? 'Discord username copied.' : state === 'failed' ? 'Couldn’t copy. Select the name instead.' : ''}
      </span>
    </>
  );
}
