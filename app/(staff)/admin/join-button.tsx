'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import styles from './[slug]/admin.module.css';

// PLAN §6.2: admins aren't super-users in SQL; they join an event as organizer explicitly.
export function JoinButton({ eventId, eventName }: { eventId: string; eventName: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  async function join() {
    setState('busy');
    const res = await fetch(`/api/admin/events/${eventId}/join`, { method: 'POST' }).catch(() => null);
    if (res?.ok) router.refresh();
    else setState('failed');
  }
  return (
    <>
      <button type="button" className={styles.secondary + ' ' + styles.small} disabled={state === 'busy'} aria-label={`Join ${eventName} as organizer`} onClick={() => void join()}>
        Join as organizer
      </button>
      {state === 'failed' && <span role="status"> ✕ Couldn’t join. Try again.</span>}
    </>
  );
}
