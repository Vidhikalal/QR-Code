'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi, useLoad } from '../api';

interface TagRow {
  id: string;
  label: string | null;
  state: 'linked' | 'unlinked' | 'retired' | 'reserved';
  retireReason: string | null;
  holder: string | null;
  linkedAt: string | null;
}
interface TagList {
  counts: { registered: number; linked: number; unlinked: number; retired: number; reserved: number };
  tags: TagRow[];
}

const STATE: Record<TagRow['state'], { text: string; cls: string }> = {
  linked: { text: '● Linked', cls: 'badgeOk' },
  unlinked: { text: '○ Not linked', cls: '' },
  retired: { text: '✕ Deactivated', cls: 'badgeBad' },
  reserved: { text: '… Reserved, not written', cls: 'badgeWarn' },
};

// PLAN §10.3 / F19: badge registry. Registering on an Android phone (Web NFC) arrives in V4b.
export function Badges({ slug }: { slug: string }) {
  const api = useApi();
  const [data, setData] = useState<TagList | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [imported, setImported] = useState<Array<{ row: number; code: string }> | null>(null);
  const [exportCount, setExportCount] = useState(50);

  const load = useCallback(async () => {
    const r = await api<TagList>(adminUrl(slug, '/tags'));
    if (r.ok) setData(r.data);
    else setMessage(`✕ ${errorText(r)}`);
  }, [api, slug]);
  useLoad(load);

  async function importFile(file: File) {
    setImported(null);
    const res = await fetch(adminUrl(slug, '/tags/import'), { method: 'POST', headers: { 'content-type': 'text/csv' }, body: await file.text() }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { results: Array<{ row: number; code: string }> };
      setImported(body.results);
      setMessage(`✓ Imported: ${body.results.filter((r) => r.code === 'REGISTERED').length} of ${body.results.length} rows registered.`);
    } else if (res?.status === 400) setMessage('✕ That file needs a header row with url (or public_id) and uid, and at most 2,000 rows.');
    else if (res?.status === 413) setMessage('✕ That file is larger than 1 MB.');
    else setMessage('✕ Import failed. Try again.');
    await load();
  }

  const t = data?.counts;
  return (
    <>
      <h1>Badges</h1>
      {message && (
        <p className={styles.alert + ' ' + (message.startsWith('✓') ? styles.alertOk : styles.alertWarn)} role="status">
          {message}
        </p>
      )}
      {t && (
        <div className={styles.tiles}>
          {(
            [
              ['registered', 'Registered', t.registered],
              ['linked', 'Linked to a person', t.linked],
              ['unlinked', 'Not linked yet', t.unlinked],
              ['retired', 'Deactivated', t.retired],
              ['reserved', 'Reserved, not written', t.reserved],
            ] as const
          ).map(([id, label, value]) => (
            <div key={id} className={styles.tile} data-testid={`badges-${id}`}>
              <span className={styles.tileLabel}>{label}</span>
              <span className={styles.tileValue}>{value.toLocaleString('en-US')}</span>
            </div>
          ))}
        </div>
      )}

      <h2>Add badges</h2>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          Import vendor CSV (url or public_id, uid, label)
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </label>
        <label className={styles.field}>
          Ids for a vendor to encode
          <input className={styles.input} type="number" min={1} max={1000} value={exportCount} onChange={(e) => setExportCount(Number(e.target.value))} />
        </label>
        <a className={`${styles.linkButton} ${styles.small} button`} href={adminUrl(slug, `/tags/export-ids?count=${exportCount}`)} onClick={() => setTimeout(() => void load(), 1500)}>
          Export ids
        </a>
        <Link className={`${styles.linkButton} ${styles.small}`} href={`/admin/${slug}/badges/print`}>
          Print sheet
        </Link>
      </div>
      <p className={styles.muted}>Register badges with an Android phone’s NFC: coming with the badge page.</p>

      {imported && (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label="Import results">
            <thead>
              <tr>
                <th>Row</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {imported.map((r) => (
                <tr key={r.row}>
                  <td className={styles.num}>{r.row}</td>
                  <td>{r.code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>All badges</h2>
      {!data ? (
        <p>Loading…</p>
      ) : data.tags.length === 0 ? (
        <p className={styles.muted}>No badges yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Label</th>
                <th>State</th>
                <th>Holder</th>
                <th>Linked at</th>
              </tr>
            </thead>
            <tbody>
              {data.tags.map((tag) => (
                <tr key={tag.id}>
                  <td>{tag.label ?? '—'}</td>
                  <td>
                    <span className={`${styles.badge} ${STATE[tag.state].cls ? styles[STATE[tag.state].cls] : ''}`}>{STATE[tag.state].text}</span>
                  </td>
                  <td>{tag.holder ?? '—'}</td>
                  <td>{tag.linkedAt ? new Date(tag.linkedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
