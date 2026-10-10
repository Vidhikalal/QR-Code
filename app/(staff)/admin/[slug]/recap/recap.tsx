'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { DEFAULT_RECAP_MESSAGE, RECAP_MESSAGE_MAX, RECAP_PLACEHOLDERS, validateRecapMessage } from '@/lib/recap/template';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { ConfirmDialog } from '../dialog';

interface Loaded {
  message: string;
  saved: string | null;
  hasPassword: boolean;
  endsAt: string;
  timezone: string;
  retentionDays: number;
  ended: boolean;
}
interface Preview {
  subject: string;
  html: string;
  text: string;
  sample: boolean;
}
type Note = { tone: 'ok' | 'warn' | 'bad'; text: string };

// PLAN F26.2: write the message, preview it, then send recaps once the event is over.
export function Recap({ slug }: { slug: string }) {
  const api = useApi();
  const [data, setData] = useState<Loaded | null>(null);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    const [s, e] = await Promise.all([
      api<{ recapMessage: string | null; badgeUnlockPassword: string | null; profileRetentionDays: number }>(adminUrl(slug, '/settings')),
      api<{ endsAt: string; timezone: string }>(adminUrl(slug, '/event')),
    ]);
    if (!s.ok) return setNote({ tone: 'bad', text: `✕ ${errorText(s)}` });
    if (!e.ok) return setNote({ tone: 'bad', text: `✕ ${errorText(e)}` });
    const msg = s.data.recapMessage ?? DEFAULT_RECAP_MESSAGE;
    setData({
      message: msg,
      saved: s.data.recapMessage,
      hasPassword: s.data.badgeUnlockPassword !== null,
      endsAt: e.data.endsAt,
      timezone: e.data.timezone,
      retentionDays: s.data.profileRetentionDays,
      ended: new Date(e.data.endsAt).getTime() <= Date.now(),
    });
    setMessage(msg);
  }, [api, slug]);
  useLoad(load);

  const check = validateRecapMessage(message);
  const problem = check.ok ? null : 'unknown' in check ? `Unknown placeholder${check.unknown.length > 1 ? 's' : ''}: ${check.unknown.join(', ')}` : `At most ${RECAP_MESSAGE_MAX} characters.`;

  async function save(): Promise<boolean> {
    if (problem) return false;
    if (message === data?.saved) return true;
    const r = await api(adminUrl(slug, '/settings'), { method: 'PATCH', body: { recapMessage: message } });
    if (!r.ok) {
      setNote({ tone: 'bad', text: `✕ ${errorText(r)}` });
      return false;
    }
    setData((d) => (d ? { ...d, saved: message } : d));
    setNote({ tone: 'ok', text: '✓ Message saved.' });
    return true;
  }

  async function showPreview() {
    if (!(await save())) return;
    const r = await api<Preview>(adminUrl(slug, '/recap/preview'), { method: 'POST', body: {} });
    if (r.ok) setPreview(r.data);
    else setNote({ tone: 'bad', text: `✕ ${errorText(r)}` });
  }

  async function send() {
    setConfirm(false);
    if (!(await save())) return;
    const r = await api<{ queued: number }>(adminUrl(slug, '/recap/send'), { method: 'POST', body: {} });
    if (r.ok) setNote({ tone: 'ok', text: r.data.queued === 0 ? '✓ Everyone who checked in already has a recap.' : `✓ Queued ${r.data.queued} recap${r.data.queued === 1 ? '' : 's'}. They go out in the next few minutes.` });
    else setNote({ tone: 'bad', text: `✕ ${r.data.error === 'EVENT_NOT_ENDED' ? 'The event hasn’t ended yet.' : r.data.error === 'NO_UNLOCK_PASSWORD' ? 'Set the badge unlock password in Settings first.' : errorText(r)}` });
  }

  if (!data) return <p role="status">{note?.text ?? 'Loading…'}</p>;
  const blocked = !data.ended ? `You can send recaps after the event ends (${formatEventDateTime(data.endsAt, data.timezone)}).` : !data.hasPassword ? 'Set the badge unlock password in Settings first: the recap tells people how to unlock their badge.' : null;

  return (
    <>
      <h1>Recap email</h1>
      <p className={styles.muted}>
        Sent once to everyone who checked in (test participants excluded). Each email has their numbers, a link to their connections and the badge unlock
        password. Send it within {data.retentionDays} days of the event: after that, profiles and connections are deleted.
      </p>
      {note && (
        <p role="status" className={`${styles.alert} ${note.tone === 'ok' ? styles.alertOk : note.tone === 'warn' ? styles.alertWarn : styles.alertBad}`}>
          {note.text}
        </p>
      )}
      <label className={styles.field}>
        Message
        <textarea className={styles.input} style={{ minHeight: 160, padding: 10 }} value={message} maxLength={RECAP_MESSAGE_MAX} onChange={(e) => setMessage(e.target.value)} aria-describedby="placeholders" />
      </label>
      <p id="placeholders" className={styles.muted}>
        Placeholders: {RECAP_PLACEHOLDERS.join(' ')}
      </p>
      {problem && (
        <p role="alert" className={`${styles.alert} ${styles.alertBad}`}>
          ✕ {problem}
        </p>
      )}
      <div className={styles.actions} style={{ flexWrap: 'wrap' }}>
        <button type="button" className={styles.secondary} disabled={problem !== null} onClick={() => void save()}>
          Save message
        </button>
        <button type="button" className={styles.secondary} disabled={problem !== null} onClick={() => void showPreview()}>
          Preview
        </button>
        <button type="button" disabled={problem !== null || blocked !== null} onClick={() => setConfirm(true)}>
          Send recaps
        </button>
      </div>
      {blocked && (
        <p className={styles.muted}>
          {blocked} {!data.hasPassword && <Link href={`/admin/${slug}/settings`}>Open Settings</Link>}
        </p>
      )}
      {preview && (
        <section aria-labelledby="preview-heading" style={{ marginTop: 16 }}>
          <h2 id="preview-heading">Preview{preview.sample ? ' (sample numbers: nobody has checked in yet)' : ''}</h2>
          <p>
            <strong>Subject:</strong> {preview.subject}
          </p>
          <iframe title="Recap email preview" sandbox="" srcDoc={preview.html} style={{ width: '100%', minHeight: 420, border: '1px solid var(--line)', borderRadius: 10, background: '#fff' }} />
          <details>
            <summary>Plain-text version</summary>
            <pre style={{ whiteSpace: 'pre-wrap' }} data-testid="recap-text">
              {preview.text}
            </pre>
          </details>
        </section>
      )}
      {confirm && (
        <ConfirmDialog
          title="Send recaps?"
          body={<p>Everyone who checked in and hasn’t had a recap gets one now. This can’t be undone.</p>}
          confirmLabel="Send recaps"
          onConfirm={() => void send()}
          onCancel={() => setConfirm(false)}
        />
      )}
    </>
  );
}
