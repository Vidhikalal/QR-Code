'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './scanner.module.css';
import { UndoDialog } from './undo-dialog';

interface Row {
  id: string;
  displayName: string;
  isTest: boolean;
  scannedAt: string;
  method: 'qr' | 'manual' | 'nfc';
  scannedByName: string | null;
  canRemove: boolean;
}

type ListState = { kind: 'loading' } | { kind: 'rows'; rows: Row[] } | { kind: 'error' };

const HOW: Record<Row['method'], string> = { qr: 'QR', nfc: 'Badge', manual: 'Manual' };

// SPEC §10.6 (v0.8): who was scanned at this checkpoint, newest first. Remove = void (F11): the server
// decides who may (organizers any scan, volunteers their own within 120 s); canRemove only shows the button.
export function ScannedHere(props: {
  slug: string;
  checkpoint: { id: string; name: string };
  timezone: string;
  /** Offline: removing would fail, so it's disabled (like Manual search). */
  disabled: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
  onRemoved: (scanId: string) => void;
}) {
  const { slug, checkpoint, onUnauthorized } = props;
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [removing, setRemoving] = useState<Row | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removingNow, setRemovingNow] = useState(false); // one removal (and its refresh) at a time
  const heading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(slug)}/checkpoints/${checkpoint.id}/scans`, { cache: 'no-store' });
      if (res.status === 401) return onUnauthorized();
      if (!res.ok) return setState({ kind: 'error' });
      setState({ kind: 'rows', rows: ((await res.json()) as { scans: Row[] }).scans });
    } catch {
      setState({ kind: 'error' });
    }
  }, [slug, checkpoint.id, onUnauthorized]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function remove(row: Row, reason: string) {
    setRemoving(null);
    setRemovingNow(true);
    await removeAndReload(row, reason);
    setRemovingNow(false);
    heading.current?.focus(); // the row (and its button) is gone: keep keyboard focus in the sheet
  }

  async function removeAndReload(row: Row, reason: string) {
    const res = await fetch(`/api/scans/${row.id}/void`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    }).catch(() => null);
    if (!res) return setNotice('✕ Couldn’t remove: no connection.');
    if (res.status === 401) return onUnauthorized();
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code === 'VOIDED' || body.code === 'ALREADY_VOIDED') {
      setNotice(`✓ Removed ${row.displayName}. They can be scanned again.`);
      props.onRemoved(row.id);
    } else if (body.code === 'FORBIDDEN') setNotice('✕ Too late to remove that one. Ask an organizer.');
    else setNotice('✕ Couldn’t remove. Try again.');
    await load();
  }

  const time = new Intl.DateTimeFormat(undefined, { timeZone: props.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const count = state.kind === 'rows' ? ` · ${state.rows.length} ${state.rows.length === 1 ? 'person' : 'people'}` : '';
  return (
    <section className={styles.sheet} aria-labelledby="scanned-title">
      <div className={styles.sheetHeader}>
        <h2 id="scanned-title" ref={heading} tabIndex={-1}>
          Scanned here
        </h2>
        {/* Focus starts inside the sheet, like Manual search's input. */}
        <button type="button" className={styles.secondary} onClick={props.onClose} autoFocus>
          Close
        </button>
      </div>
      <p className={styles.notice}>
        {checkpoint.name}
        {count}
      </p>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {state.kind === 'loading' && <p className={styles.notice}>Loading…</p>}
      {state.kind === 'error' && <p className={styles.notice}>✕ Couldn’t load the list. Try again.</p>}
      {state.kind === 'rows' && state.rows.length === 0 && <p className={styles.notice}>No one yet.</p>}
      {state.kind === 'rows' && state.rows.length > 0 && (
        <ul className={styles.results}>
          {state.rows.map((r) => (
            <li key={r.id} className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowName}>
                  {r.displayName}
                  {r.isTest && ' (test)'}
                </div>
                <div className={styles.rowMeta}>
                  {time.format(new Date(r.scannedAt))} · {HOW[r.method]}
                  {r.scannedByName && ` · by ${r.scannedByName}`}
                </div>
              </div>
              {r.canRemove && (
                <button type="button" className={styles.secondary} disabled={props.disabled || removingNow} onClick={() => setRemoving(r)} aria-label={`Remove ${r.displayName}`}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {removing && <UndoDialog title={`Remove ${removing.displayName}?`} onSubmit={(reason) => void remove(removing, reason)} onCancel={() => setRemoving(null)} />}
    </section>
  );
}
