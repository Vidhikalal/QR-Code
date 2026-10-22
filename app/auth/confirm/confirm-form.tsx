'use client';

import { useSyncExternalStore } from 'react';
import styles from '../../login/login.module.css';

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};

// The link's token arrives in the URL fragment, which browsers never send to the server (like I-3).
// It leaves the page only in the POST that spends it.
export function ConfirmForm(props: { action: (form: FormData) => Promise<void>; type: string; next: string }) {
  const tokenHash = useSyncExternalStore(subscribe, () => window.location.hash.replace(/^#/, ''), () => '');
  return (
    <form action={props.action} className={styles.form}>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={props.type} />
      <input type="hidden" name="next" value={props.next} />
      <button type="submit" disabled={!tokenHash}>
        Continue
      </button>
    </form>
  );
}
