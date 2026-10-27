'use client';

import { useCallback, useState } from 'react';
import { toLocalInput, zonedToUtc } from '@/lib/domain/event-time';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi, useLoad } from '../api';

interface EventInfo {
  schedule: string;
  emergencyInfo: string;
  /** v0.9 (F13): an instant from the API; edited as a datetime-local in the event timezone. */
  rsvpDeadline: string | null;
  timezone: string;
}

// SPEC §11 Info (v0.6): plain text hackers see in their menu (F14). Line breaks are kept; nothing is HTML.
export function Info({ slug }: { slug: string }) {
  const api = useApi();
  const [info, setInfo] = useState<EventInfo | null>(null);
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<EventInfo>(adminUrl(slug, '/event'));
    if (r.ok) {
      setInfo({ schedule: r.data.schedule, emergencyInfo: r.data.emergencyInfo, rsvpDeadline: r.data.rsvpDeadline, timezone: r.data.timezone });
      setDeadline(r.data.rsvpDeadline ? toLocalInput(r.data.rsvpDeadline, r.data.timezone) : '');
    } else setError(errorText(r));
  }, [api, slug]);

  useLoad(load);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!info) return;
    setBusy(true);
    setMessage(null);
    const body = { schedule: info.schedule, emergencyInfo: info.emergencyInfo, rsvpDeadline: deadline ? zonedToUtc(deadline, info.timezone) : null };
    const r = await api<EventInfo>(adminUrl(slug, '/event'), { method: 'PATCH', body });
    setBusy(false);
    if (r.ok) {
      setError(null);
      setMessage('✓ Saved. Hackers see it in their menu.');
    } else setError(r.status === 400 ? 'Too long: the schedule fits 5,000 characters, emergency info 2,000.' : errorText(r));
  }

  return (
    <>
      <h1>Info for hackers</h1>
      <p className={styles.muted}>Shown on each accepted hacker’s Schedule and Emergency contact pages. Plain text; line breaks are kept. In the schedule, a line like 12:00-13:00 | Lunch | Cafeteria shows as a time slot, under the line above it (e.g. Saturday, Nov 7).</p>
      {info && (
        <form onSubmit={(e) => void save(e)} style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
          <label className={styles.field}>
            Schedule
            <textarea
              className={styles.input}
              style={{ minHeight: 220, padding: 10 }}
              maxLength={5000}
              value={info.schedule}
              onChange={(e) => setInfo({ ...info, schedule: e.target.value })}
              placeholder={'Saturday, Nov 7\n9:00-10:00 | Check-in | Main lobby\n10:00-10:30 | Opening ceremony | Auditorium\n12:00-13:00 | Lunch | Cafeteria'}
            />
          </label>
          <label className={styles.field}>
            Emergency info
            <textarea
              className={styles.input}
              style={{ minHeight: 120, padding: 10 }}
              maxLength={2000}
              value={info.emergencyInfo}
              onChange={(e) => setInfo({ ...info, emergencyInfo: e.target.value })}
              placeholder={'Organizer on call: …\nVenue security: …\nIn a life-threatening emergency, call 911.'}
            />
          </label>
          <label className={styles.field}>
            RSVP deadline ({info.timezone})
            <input className={styles.input} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            <span className={styles.muted}>
              No reply by then counts as a no. Invitees get a reminder at 10:00 on the deadline day and the two days before. Someone invited late gets 48 hours. Leave it empty for no deadline.
            </span>
          </label>
          <div>
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className={`${styles.alert} ${styles.alertBad}`} role="alert">
          ✕ {error}
        </p>
      )}
      {message && (
        <p className={`${styles.alert} ${styles.alertOk}`} role="status">
          {message}
        </p>
      )}
    </>
  );
}
