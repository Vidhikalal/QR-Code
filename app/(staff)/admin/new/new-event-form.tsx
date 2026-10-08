'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { suggestSlug } from '@/lib/events/slug';
import styles from '../[slug]/admin.module.css';

const MESSAGES: Record<string, string> = {
  SLUG_TAKEN: 'That slug is already used by another event. Pick a different one.',
  INVALID_DATES: 'The end must be after the start.',
  INVALID_TIMEZONE: 'That time zone isn’t recognized.',
};

// Times are typed as wall-clock times in the chosen time zone, never the device's (I-8).
export function NewEventForm({ timeZones }: { timeZones: string[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [venue, setVenue] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, slug, venue, startsAt, endsAt, timezone }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) as { code?: string; slug?: string };
    if (res?.ok && data.code === 'CREATED' && data.slug) {
      router.push(`/admin/${data.slug}/checkpoints`);
      return;
    }
    setBusy(false);
    if (!res) setError('Network error. Check your connection and try again.');
    else if (res.status === 400) setError('Check the fields: the slug uses 3–40 lowercase letters, digits or hyphens (not “new” or “events”).');
    else if (res.status === 403) setError('Only platform admins can create events.');
    else setError(MESSAGES[data.code ?? ''] ?? `Something went wrong (${res.status}). Try again.`);
  }

  return (
    <form
      className={styles.drawer}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className={styles.dialogForm}>
        <label className={styles.field}>
          Event name
          <input
            className={styles.input}
            required
            maxLength={120}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugEdited) setSlug(suggestSlug(e.target.value));
            }}
          />
        </label>
        <label className={styles.field}>
          Slug (used in links, e.g. /scan/{slug || 'hack-day-2026'})
          <input
            className={styles.input}
            required
            pattern="[a-z0-9\-]{3,40}"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugEdited(true);
            }}
          />
        </label>
        <label className={styles.field}>
          Venue
          <input className={styles.input} required maxLength={200} value={venue} onChange={(e) => setVenue(e.target.value)} />
        </label>
        <label className={styles.field}>
          Starts
          <input className={styles.input} type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className={styles.field}>
          Ends
          <input className={styles.input} type="datetime-local" required value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </label>
        <label className={styles.field}>
          Time zone (start and end are in this zone)
          <select className={styles.input} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {timeZones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className={styles.alert + ' ' + styles.alertBad} role="alert">
          ✕ {error}
        </p>
      )}
      <div className={styles.dialogActions}>
        <Link href="/admin" className={styles.linkButton + ' ' + styles.small}>
          Cancel
        </Link>
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create event'}
        </button>
      </div>
    </form>
  );
}
