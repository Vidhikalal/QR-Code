'use client';

import { useCallback, useState } from 'react';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi, useLoad } from '../api';

interface EventInfo {
  schedule: string;
  emergencyInfo: string;
}

// SPEC §11 Info (v0.6): plain text hackers see in their menu (F14). Line breaks are kept; nothing is HTML.
export function Info({ slug }: { slug: string }) {
  const api = useApi();
  const [info, setInfo] = useState<EventInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<EventInfo>(adminUrl(slug, '/event'));
    if (r.ok) setInfo({ schedule: r.data.schedule, emergencyInfo: r.data.emergencyInfo });
    else setError(errorText(r));
  }, [api, slug]);

  useLoad(load);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!info) return;
    setBusy(true);
    setMessage(null);
    const r = await api<EventInfo>(adminUrl(slug, '/event'), { method: 'PATCH', body: info });
    setBusy(false);
    if (r.ok) {
      setError(null);
      setMessage('✓ Saved. Hackers see it in their menu.');
    } else setError(r.status === 400 ? 'Too long: the schedule fits 5,000 characters, emergency info 2,000.' : errorText(r));
  }

  return (
    <>
      <h1>Info for hackers</h1>
      <p className={styles.muted}>Shown on each accepted hacker’s Schedule and Emergency contact pages. Plain text; line breaks are kept.</p>
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
              placeholder={'Sat 9:00  Check-in\nSat 10:00  Opening\nSat 12:00  Lunch'}
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
