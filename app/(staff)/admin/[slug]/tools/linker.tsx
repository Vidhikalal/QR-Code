'use client';

import { useRef, useState } from 'react';
import { formatUid, normalizeUid } from '@/lib/domain/badge';
import { useNfcReader } from '@/lib/scanner/nfc';
import styles from '../admin.module.css';

type Person = { id: string; displayName: string; status: string; email: string };
type Status = { tone: 'info' | 'ok' | 'bad'; text: string };

// SPEC §11 Tools (v0.5): attendees claim their own badge from their phone; this links one for someone who
// can't, or moves a badge claimed by the wrong person (an organizer's link moves it). The outcome is a
// notice, never a green screen (I-1).
export function BadgeLinker({ slug }: { slug: string }) {
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [target, setTarget] = useState<Person | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const linking = useRef(false);

  async function search() {
    setStatus(null);
    const res = await fetch(`/api/events/${encodeURIComponent(slug)}/participants/search?q=${encodeURIComponent(q)}`, {
      cache: 'no-store',
    }).catch(() => null);
    if (!res) return setStatus({ tone: 'bad', text: 'No connection. Try again.' });
    if (res.status === 400) return setStatus({ tone: 'bad', text: 'Type at least 2 letters of their name.' });
    if (!res.ok) return setStatus({ tone: 'bad', text: 'Search failed. Try again.' });
    setPeople(((await res.json()) as { results: Person[] }).results);
  }

  async function link(serial: string, person: Person) {
    const uid = normalizeUid(serial);
    if (!uid) return setStatus({ tone: 'bad', text: 'Couldn’t read that badge. Hold it still and tap again.' });
    if (linking.current) return; // Android can report one tap twice
    linking.current = true;
    nfc.stop();
    setStatus({ tone: 'info', text: `Linking ${formatUid(uid)}…` });
    const res = await fetch(`/api/events/${encodeURIComponent(slug)}/badges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participantId: person.id, uid }),
    }).catch(() => null);
    linking.current = false;
    setTarget(null);
    const code = res?.ok ? ((await res.json()) as { code?: string }).code : undefined;
    if (code === 'LINKED') setStatus({ tone: 'ok', text: `Badge ${formatUid(uid)} linked to ${person.displayName}.` });
    else if (code === 'BADGE_TAKEN') setStatus({ tone: 'bad', text: `Badge ${formatUid(uid)} is linked to someone else.` });
    else if (code === 'NOT_FOUND') setStatus({ tone: 'bad', text: `${person.displayName} isn’t in this event any more.` });
    else setStatus({ tone: 'bad', text: 'Badge not linked. Try again.' });
  }

  const nfc = useNfcReader({
    prefKey: 'passline:linker',
    defaultOn: false,
    autoStart: false,
    onTag: ({ serial }) => {
      if (target) void link(serial, target);
    },
    onUnreadable: () => setStatus({ tone: 'bad', text: 'Couldn’t read that badge. Hold it still and tap again.' }),
  });

  function pick(person: Person) {
    setTarget(person);
    setStatus({ tone: 'info', text: `Tap the badge to link it to ${person.displayName}.` });
    if (nfc.state === 'off') void nfc.start(); // this tap is the user gesture Chrome needs
  }

  function cancel() {
    nfc.stop();
    setTarget(null);
    setStatus(null);
  }

  if (!nfc.supported) return null; // §10.5: no NFC controls (and no fallback text) without Web NFC

  return (
    <section aria-labelledby="link-heading">
      <h2 id="link-heading">Link a badge</h2>
      <p>
        Attendees link their own badge by tapping it with their phone and signing in. Use this for someone who can’t,
        or to move a badge that someone else claimed.
      </p>
      <form className={styles.toolbar} onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}>
        <label className={styles.field}>
          Name
          <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name" />
        </label>
        <button type="submit">Search</button>
      </form>
      {people?.length === 0 && <p className={styles.muted}>No one found.</p>}
      {people && people.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
          {people.map((p) => (
            <li key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>
                <strong>{p.displayName}</strong> <span className={styles.muted}>{p.email}</span>{' '}
                <span className={styles.badge}>{p.status}</span>
              </span>
              <button
                type="button"
                className={styles.small}
                aria-pressed={target?.id === p.id}
                onClick={() => (target?.id === p.id ? cancel() : pick(p))}
              >
                {target?.id === p.id ? 'Cancel' : `Link a badge to ${p.displayName}`}
              </button>
            </li>
          ))}
        </ul>
      )}
      {nfc.error && (
        <p className={`${styles.alert} ${styles.alertBad}`} role="alert">
          ✕ {nfc.error}
        </p>
      )}
      {status && (
        <p className={`${styles.alert} ${status.tone === 'ok' ? styles.alertOk : status.tone === 'bad' ? styles.alertBad : ''}`} role="status">
          {status.tone === 'ok' ? '✓ ' : status.tone === 'bad' ? '✕ ' : ''}
          {status.text}
        </p>
      )}
    </section>
  );
}
