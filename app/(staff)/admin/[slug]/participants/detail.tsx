'use client';

import Image from 'next/image';
import { useCallback, useState } from 'react';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { VoidDialog } from '../dialog';
import { fullName } from './name';

interface Detail {
  participant: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    status: string;
    source: string;
    applicantId: string | null;
    dietaryNotes: string | null;
    linkedinUrl: string | null;
    emergency: { name: string; phone: string; relation: string | null } | null;
    overnight: string | null;
    teamStatus: string | null;
    allergies: string | null;
    allergySeverity: string | null;
    accessibility: string | null;
    photoUrl: string | null;
    photoUpdatedAt: string | null;
  };
  scans: Array<{ id: string; checkpointName: string; kind: string; scannedAt: string; method: string; scannedByName: string | null; voided: boolean; voidReason: string | null }>;
}

// v0.9 profile setup answers, as the hacker chose them (F14).
const OVERNIGHT: Record<string, string> = { yes: 'Yes', no: 'No', unsure: 'Not sure yet' };
const TEAM_STATUS: Record<string, string> = { team: 'Has a team', looking: 'Looking for a team', solo: 'Going solo' };

const VOID_TEXT: Record<string, string> = {
  VOIDED: '✓ Scan voided.',
  ALREADY_VOIDED: '! That scan was already voided.',
  NOT_FOUND: '✕ Scan not found.',
  FORBIDDEN: '✕ You can’t void that scan.',
};

// Scan history + void (F11). Organizers may void any scan at any time; void_scan() enforces it.
export function ParticipantDetail(props: { slug: string; id: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const api = useApi();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [timezone, setTimezone] = useState<string>('UTC');
  const [voiding, setVoiding] = useState<Detail['scans'][number] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, e] = await Promise.all([
      api<Detail>(adminUrl(props.slug, `/participants/${props.id}`)),
      api<{ timezone: string }>(adminUrl(props.slug, '/event')),
    ]);
    if (d.ok) setDetail(d.data);
    else setMessage(`✕ ${errorText(d)}`);
    if (e.ok) setTimezone(e.data.timezone);
  }, [api, props.slug, props.id]);

  useLoad(load);

  async function voidScan(scanId: string, reason: string) {
    setVoiding(null);
    const r = await api<{ code: string }>(`/api/scans/${scanId}/void`, { method: 'POST', body: { reason } });
    setMessage(r.ok ? (VOID_TEXT[r.data.code] ?? r.data.code) : `✕ ${errorText(r)}`);
    await load();
    await props.onChanged();
  }

  if (!detail) return <section className={styles.drawer}>{message ?? 'Loading…'}</section>;
  const p = detail.participant;
  const name = fullName(p);
  const time = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));

  return (
    <section className={styles.drawer} aria-labelledby="detail-title">
      <div className={styles.toolbar}>
        <h2 id="detail-title" style={{ flex: 1 }}>
          {name}
        </h2>
        <button type="button" className={styles.secondary} onClick={props.onClose}>
          Close
        </button>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {p.photoUrl ? (
          <Image className={styles.photo} src={p.photoUrl} alt={`Photo of ${name}`} width={160} height={160} unoptimized />
        ) : (
          <div className={styles.photo} role="img" aria-label="No photo" />
        )}
        <dl style={{ margin: 0 }}>
          <dt className={styles.muted}>Email</dt>
          <dd>{p.email}</dd>
          <dt className={styles.muted}>Status</dt>
          <dd>
            {p.status} · {p.source}
          </dd>
          {p.dietaryNotes && (
            <>
              <dt className={styles.muted}>Dietary notes</dt>
              <dd>{p.dietaryNotes}</dd>
            </>
          )}
          {p.emergency && (
            <>
              <dt className={styles.muted}>Emergency contact</dt>
              <dd>
                {p.emergency.name}
                {p.emergency.relation && ` (${p.emergency.relation})`} · <a href={`tel:${p.emergency.phone.replace(/[^0-9+]/g, '')}`}>{p.emergency.phone}</a>
              </dd>
            </>
          )}
          {p.allergies && (
            <>
              <dt className={styles.muted}>Allergies</dt>
              <dd>
                {p.allergySeverity === 'severe' ? <strong>Severe: {p.allergies}</strong> : `${p.allergies} (${p.allergySeverity ?? ''})`}
              </dd>
            </>
          )}
          {p.accessibility && (
            <>
              <dt className={styles.muted}>Accessibility</dt>
              <dd>{p.accessibility}</dd>
            </>
          )}
          <dt className={styles.muted}>Overnight</dt>
          <dd>{p.overnight ? OVERNIGHT[p.overnight] : 'Not answered'}</dd>
          <dt className={styles.muted}>Team</dt>
          <dd>{p.teamStatus ? TEAM_STATUS[p.teamStatus] : 'Not answered'}</dd>
          {p.photoUpdatedAt && (
            <>
              <dt className={styles.muted}>Photo updated</dt>
              <dd>{time(p.photoUpdatedAt)}</dd>
            </>
          )}
        </dl>
      </div>
      {message && (
        <p className={styles.alert + ' ' + (message.startsWith('✓') ? styles.alertOk : styles.alertWarn)} role="status">
          {message}
        </p>
      )}
      <h3>Scan history</h3>
      {detail.scans.length === 0 ? (
        <p className={styles.muted}>No scans.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Checkpoint</th>
                <th>When</th>
                <th>By</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {detail.scans.map((s) => (
                <tr key={s.id}>
                  <td>{s.checkpointName}</td>
                  <td>{time(s.scannedAt)}</td>
                  <td>
                    {s.scannedByName ?? '—'} ({s.method})
                  </td>
                  <td>{s.voided ? `✕ Voided: ${s.voidReason ?? ''}` : '✓ Live'}</td>
                  <td>
                    {!s.voided && (
                      <button type="button" className={`${styles.secondary} ${styles.small}`} aria-label={`Void ${s.checkpointName} scan`} onClick={() => setVoiding(s)}>
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {voiding && <VoidDialog what={`${voiding.checkpointName} scan`} onSubmit={(reason) => void voidScan(voiding.id, reason)} onCancel={() => setVoiding(null)} />}
    </section>
  );
}
