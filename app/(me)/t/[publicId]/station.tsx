'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Involvement, StationCheckpoint } from '@/lib/badge/view';
import { scanResponseSchema } from '@/lib/scan/schema';
import { viewFor, type ResultView } from '@/lib/scanner/result-view';
import styles from './badge.module.css';

const UNDO_MS = 120_000;
const clock = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

// PLAN F21 (iPhone): check the badge's wearer in at this staff member's station. Every decision is
// record_scan()'s (I-2); the result looks exactly like the scanner's (viewFor, I-1). POST only (I-17).
export function StationAction(props: { publicId: string; station: StationCheckpoint | null; checkpoints: StationCheckpoint[]; timezone: string }) {
  const router = useRouter();
  const [station, setStation] = useState(props.station);
  const [picking, setPicking] = useState(props.station === null);
  const [result, setResult] = useState<ResultView | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [lastOwn, setLastOwn] = useState<{ scanId: string; at: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // "Undo my last scan" disappears 120 s after the scan (void_scan enforces the window too).
  useEffect(() => {
    if (!lastOwn) return;
    const t = setTimeout(() => setLastOwn(null), Math.max(0, lastOwn.at + UNDO_MS - Date.now()));
    return () => clearTimeout(t);
  }, [lastOwn]);

  async function choose(cp: StationCheckpoint) {
    const res = await fetch('/api/stations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ checkpointId: cp.checkpointId }) }).catch(() => null);
    if (res?.ok) {
      setStation(cp);
      setPicking(false);
      setResult(null);
    }
  }

  async function checkIn(confirmRepeat = false) {
    if (!station) return;
    setBusy(true);
    setRepeat(false);
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        checkpointId: station.checkpointId,
        method: 'nfc',
        tagPublicId: props.publicId,
        clientScanId: crypto.randomUUID(), // a new physical decision each time (PLAN F22)
        clientScannedAt: new Date().toISOString(),
        ...(confirmRepeat && { confirmRepeat: true }),
      }),
    }).catch(() => null);
    setBusy(false);
    const ctx = { checkpointKind: station.kind, checkpointName: station.name, timezone: props.timezone, now: new Date() };
    const parsed = res?.ok ? scanResponseSchema.safeParse(await res.json().catch(() => null)) : null;
    if (!parsed?.success) {
      setResult(viewFor(res?.status === 429 ? { kind: 'rate_limited' } : { kind: 'network' }, ctx));
      return;
    }
    const data = parsed.data;
    setResult(viewFor({ kind: 'server', data }, ctx));
    setRepeat(data.code === 'REPEAT_SERVING');
    if (data.code === 'ACCEPTED' && data.scanId && !data.replayed) {
      setLastOwn({ scanId: data.scanId, at: Date.now() });
      router.refresh(); // the involvement summary picks up the new scan
    }
  }

  async function undo() {
    if (!lastOwn) return;
    const res = await fetch(`/api/scans/${lastOwn.scanId}/void`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Wrong person' }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { code?: string } | undefined;
    setLastOwn(null);
    setResult(null);
    if (body?.code === 'VOIDED') router.refresh();
  }

  return (
    <div className={styles.station}>
      {picking || !station ? (
        <>
          <p className={styles.muted}>Which checkpoint are you working?</p>
          <div className={styles.actions}>
            {props.checkpoints.map((cp) => (
              <button key={cp.checkpointId} type="button" className={styles.secondary} onClick={() => void choose(cp)}>
                {cp.name}
              </button>
            ))}
            {props.checkpoints.length === 0 && <span className={styles.muted}>No checkpoint is open.</span>}
          </div>
        </>
      ) : (
        <>
          <button type="button" className={styles.big} disabled={busy} onClick={() => void checkIn()}>
            Check in to {station.name}
          </button>
          <button type="button" className={styles.linkish} onClick={() => setPicking(true)}>
            Change station
          </button>
        </>
      )}
      {result && (
        <div className={styles.result} data-tone={result.tone} data-testid="station-result" role="status">
          <span aria-hidden="true">{result.icon}</span> <strong>{result.headline}</strong>
          {result.name && <div>{result.name}</div>}
          {result.emphasis && <div className={styles.emphasis}>{result.emphasis}</div>}
          {result.detail && <div>{result.detail}</div>}
          {repeat && (
            <div className={styles.actions}>
              <button type="button" onClick={() => void checkIn(true)}>
                Serve again
              </button>
              <button type="button" className={styles.secondary} onClick={() => { setRepeat(false); setResult(null); }}>
                Don’t serve
              </button>
            </div>
          )}
        </div>
      )}
      {lastOwn && (
        <button type="button" className={styles.secondary} onClick={() => void undo()}>
          Undo my last scan
        </button>
      )}
    </div>
  );
}

export function InvolvementSummary({ involvement: v, timezone }: { involvement: Involvement; timezone: string }) {
  return (
    <div className={styles.involvement} aria-label="Involvement">
      <h3>Today</h3>
      <ul>
        <li>{v.doorAt ? `Checked in at ${clock(v.doorAt, timezone)}` : 'Not checked in at the door'}</li>
        {v.meals.map((m) => (
          <li key={m.checkpointId}>
            {m.name}: {m.servings.length} serving{m.servings.length === 1 ? '' : 's'} ({m.servings.map((s) => clock(s.at, timezone)).join(', ')})
          </li>
        ))}
        {v.activities.map((a) => (
          <li key={a.checkpointId}>
            {a.name} at {clock(a.at, timezone)}
            {a.points > 0 ? ` · +${a.points} pts` : ''}
          </li>
        ))}
      </ul>
      <p data-testid="involvement-points">
        <strong>{v.points}</strong> activity points
      </p>
    </div>
  );
}
