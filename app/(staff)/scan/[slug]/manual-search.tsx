'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { searchQuery } from '@/lib/domain/search';
import { nfcSupported } from '@/lib/scanner/nfc';
import styles from './scanner.module.css';

export interface Row {
  id: string;
  displayName: string;
  status: string;
  email: string;
  photoUrl: string | null;
  scannedHere: boolean;
  hasBadge: boolean;
}

type SearchState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'rows'; rows: Row[] } | { kind: 'error' };
const subscribeNever = () => () => undefined;

// SPEC §10.4. Results come from the server; nothing is cached on the device.
export function ManualSearch(props: {
  slug: string;
  checkpointId: string;
  disabled: boolean;
  onRecord: (participantId: string) => void;
  onLinkBadge: (row: Row) => void;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const { slug, checkpointId, disabled } = props;
  const [q, setQ] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const valid = searchQuery(q) !== null;
  const supported = useSyncExternalStore(subscribeNever, nfcSupported, () => false);
  const onUnauthorized = useRef(props.onUnauthorized);

  useEffect(() => {
    onUnauthorized.current = props.onUnauthorized;
  }, [props.onUnauthorized]);

  useEffect(() => {
    if (!valid || disabled) return;
    let stale = false;
    const t = setTimeout(async () => {
      setState({ kind: 'loading' });
      try {
        const url = `/api/events/${encodeURIComponent(slug)}/participants/search?q=${encodeURIComponent(q)}&checkpointId=${checkpointId}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (stale) return;
        if (res.status === 401) return onUnauthorized.current();
        if (!res.ok) return setState({ kind: 'error' });
        const body = (await res.json()) as { results: Row[] };
        if (!stale) setState({ kind: 'rows', rows: body.results });
      } catch {
        if (!stale) setState({ kind: 'error' });
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [slug, checkpointId, q, valid, disabled]);

  return (
    <section className={styles.sheet} aria-labelledby="search-title">
      <div className={styles.sheetHeader}>
        <h2 id="search-title">Manual search</h2>
        <button type="button" className={styles.secondary} onClick={props.onClose}>
          Close
        </button>
      </div>
      <label htmlFor="manual-q" className="visually-hidden">
        Name
      </label>
      <input
        id="manual-q"
        className={styles.searchInput}
        placeholder="Type a name"
        autoComplete="off"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {!valid && q !== '' && <p className={styles.notice}>Type at least 2 letters.</p>}
      {valid && state.kind === 'loading' && <p className={styles.notice}>Searching…</p>}
      {valid && state.kind === 'error' && <p className={styles.notice}>✕ Search failed. Try again.</p>}
      {valid && state.kind === 'rows' && state.rows.length === 0 && <p className={styles.notice}>No one found.</p>}
      {valid && state.kind === 'rows' && (
        <ul className={styles.results}>
          {state.rows.map((r) => (
            <li key={r.id} className={styles.row} data-testid="search-row">
              {r.photoUrl ? (
                <Image className={styles.rowPhoto} src={r.photoUrl} alt="" width={56} height={56} unoptimized />
              ) : (
                <span className={styles.rowPhoto} aria-hidden="true" />
              )}
              <div className={styles.rowText}>
                <div className={styles.rowName}>{r.displayName}</div>
                <div className={styles.rowMeta}>
                  <span className={styles.badge}>{r.status}</span>
                  {r.scannedHere && <span className={`${styles.badge} ${styles.badgeWarn}`}>✓ Already scanned here</span>}
                  {r.hasBadge && <span className={styles.badge}>Badge linked</span>}
                  {r.email}
                </div>
              </div>
              <div className={styles.rowActions}>
                <button type="button" disabled={disabled} onClick={() => props.onRecord(r.id)} aria-label={`Record scan for ${r.displayName}`}>
                  Record scan
                </button>
                {supported && r.status === 'accepted' && (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={disabled}
                    onClick={() => props.onLinkBadge(r)}
                    aria-label={`${r.hasBadge ? 'Replace' : 'Link'} badge for ${r.displayName}`}
                  >
                    {r.hasBadge ? 'Replace badge' : 'Link badge'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
