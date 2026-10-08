'use client';

import { useCallback, useState } from 'react';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi, useLoad } from '../api';

interface SettingsData {
  leaderboardRefreshMinutes: 0 | 15 | 30 | 60;
  organizerConnectionBonus: number;
  organizersCompete: boolean;
  badgeUnlockPassword: string | null;
  profileRetentionDays: number;
}

// PLAN F14 step 3. Leaderboards, networking and recap use these from V6–V8; they can be set now.
export function Settings({ slug }: { slug: string }) {
  const api = useApi();
  const [loaded, setLoaded] = useState<SettingsData | null>(null);
  const [form, setForm] = useState<SettingsData | null>(null);
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<SettingsData>(adminUrl(slug, '/settings'));
    if (r.ok) {
      setLoaded(r.data);
      setForm(r.data);
      setPassword(r.data.badgeUnlockPassword ?? '');
    } else setMessage(`✕ ${errorText(r)}`);
  }, [api, slug]);

  useLoad(load);

  async function save(f: SettingsData) {
    const next: SettingsData = { ...f, badgeUnlockPassword: password === '' ? null : password };
    // Only the fields that changed, so the audit row names exactly what was edited.
    const body = Object.fromEntries(Object.entries(next).filter(([k, v]) => loaded?.[k as keyof SettingsData] !== v));
    if (Object.keys(body).length === 0) {
      setMessage('✓ Nothing changed.');
      return;
    }
    const r = await api<{ code: string }>(adminUrl(slug, '/settings'), { method: 'PATCH', body });
    if (r.ok) setMessage('✓ Settings saved.');
    else setMessage(r.status === 400 ? '✕ Check the values: bonus 0–100, retention 1–3650 days, password 4–32 characters.' : `✕ ${errorText(r)}`);
    await load();
  }

  if (!form) return message ? <p role="status">{message}</p> : <p>Loading…</p>;
  const set = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => setForm({ ...form, [key]: value });

  return (
    <>
      <h1>Settings</h1>
      {message && (
        <p className={styles.alert + ' ' + (message.startsWith('✓') ? styles.alertOk : styles.alertWarn)} role="status">
          {message}
        </p>
      )}
      <form
        className={styles.drawer}
        onSubmit={(e) => {
          e.preventDefault();
          void save(form);
        }}
      >
        <div className={styles.dialogForm}>
          <label className={styles.field}>
            Leaderboard refresh on the projector
            <select
              className={styles.input}
              value={form.leaderboardRefreshMinutes}
              onChange={(e) => set('leaderboardRefreshMinutes', Number(e.target.value) as SettingsData['leaderboardRefreshMinutes'])}
            >
              <option value={0}>Live</option>
              <option value={15}>Every 15 minutes</option>
              <option value={30}>Every 30 minutes</option>
              <option value={60}>Every hour</option>
            </select>
          </label>
          <label className={styles.field}>
            Bonus points for connecting with an organizer
            <input
              className={styles.input}
              type="number"
              min={0}
              max={100}
              required
              value={form.organizerConnectionBonus}
              onChange={(e) => set('organizerConnectionBonus', Number(e.target.value))}
            />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={form.organizersCompete} onChange={(e) => set('organizersCompete', e.target.checked)} />
            Organizers appear on leaderboards (can win prizes)
          </label>
          <label className={styles.field}>
            Badge unlock password (shared by every badge; sent in the recap email)
            <span className={styles.actions}>
              <input
                className={styles.input}
                type={reveal ? 'text' : 'password'}
                autoComplete="off"
                minLength={4}
                maxLength={32}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className={styles.secondary + ' ' + styles.small} aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
                {reveal ? 'Hide' : 'Reveal'}
              </button>
            </span>
          </label>
          <label className={styles.field}>
            Keep profiles online for this many days after the event
            <input
              className={styles.input}
              type="number"
              min={1}
              max={3650}
              required
              value={form.profileRetentionDays}
              onChange={(e) => set('profileRetentionDays', Number(e.target.value))}
            />
          </label>
        </div>
        <div className={styles.dialogActions}>
          <button type="submit">Save settings</button>
        </div>
      </form>
    </>
  );
}
