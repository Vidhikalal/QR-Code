'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatEventDateTime, toLocalInput, zonedToUtc } from '@/lib/domain/event-time';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { ConfirmDialog, Modal, VoidDialog } from '../dialog';

type Kind = 'door' | 'meal' | 'session' | 'custom';
interface Checkpoint {
  id: string;
  name: string;
  kind: Kind;
  isOpen: boolean;
  requiresCheckin: boolean;
  capacity: number | null;
  startsAt: string | null;
  sortOrder: number;
}

const KINDS: Kind[] = ['door', 'meal', 'session', 'custom'];
const ERROR_TEXT: Record<string, string> = {
  DOOR_EXISTS: 'This event already has a door checkpoint.',
  NAME_TAKEN: 'Another checkpoint already has that name.',
};

export function Checkpoints({ slug }: { slug: string }) {
  const api = useApi();
  const [rows, setRows] = useState<Checkpoint[] | null>(null);
  const [timezone, setTimezone] = useState('UTC');
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Checkpoint | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Checkpoint | null>(null);
  // `opened` re-keys the panel, so pressing People again reloads the list.
  const [people, setPeople] = useState<{ checkpoint: Checkpoint; opened: number } | null>(null);
  const peopleButtons = useRef(new Map<string, HTMLButtonElement>());

  const load = useCallback(async () => {
    const [r, e] = await Promise.all([api<{ checkpoints: Checkpoint[] }>(adminUrl(slug, '/checkpoints')), api<{ timezone: string }>(adminUrl(slug, '/event'))]);
    if (r.ok) setRows(r.data.checkpoints);
    else setMessage(`✕ ${errorText(r)}`);
    if (e.ok) setTimezone(e.data.timezone);
  }, [api, slug]);

  useLoad(load);

  async function toggle(c: Checkpoint) {
    const r = await api(adminUrl(slug, `/checkpoints/${c.id}`), { method: 'PATCH', body: { isOpen: !c.isOpen } });
    setMessage(r.ok ? `✓ ${c.name} is now ${c.isOpen ? 'closed' : 'open'}.` : `✕ ${errorText(r)}`);
    await load();
  }

  async function remove(c: Checkpoint) {
    setDeleting(null);
    const r = await api(adminUrl(slug, `/checkpoints/${c.id}`), { method: 'DELETE' });
    setMessage(r.ok ? `✓ Deleted ${c.name}.` : `✕ ${errorText(r)}`);
    await load();
  }

  return (
    <>
      <h1>Checkpoints</h1>
      <div className={styles.toolbar}>
        <button type="button" onClick={() => setEditing('new')}>
          Add checkpoint
        </button>
      </div>
      {message && (
        <p className={styles.alert + ' ' + (message.startsWith('✓') ? styles.alertOk : styles.alertWarn)} role="status">
          {message}
        </p>
      )}
      {rows === null ? (
        <p>Loading…</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>State</th>
                <th>Needs check-in</th>
                <th className={styles.num}>Capacity</th>
                <th>Starts</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.kind}</td>
                  <td>
                    <span data-testid="cp-state" className={`${styles.badge} ${c.isOpen ? styles.badgeOk : ''}`}>
                      {c.isOpen ? '● Open' : '○ Closed'}
                    </span>
                  </td>
                  <td>{c.requiresCheckin ? 'Yes' : 'No'}</td>
                  <td className={styles.num}>{c.capacity ?? '—'}</td>
                  <td>{c.startsAt ? formatEventDateTime(c.startsAt, timezone) : '—'}</td>
                  <td>
                    <div className={styles.actions}>
                      <button type="button" className={styles.small} aria-label={`${c.isOpen ? 'Close' : 'Open'} ${c.name}`} onClick={() => void toggle(c)}>
                        {c.isOpen ? 'Close' : 'Open'}
                      </button>
                      <button type="button" className={`${styles.secondary} ${styles.small}`} aria-label={`People at ${c.name}`} ref={(el) => void (el ? peopleButtons.current.set(c.id, el) : peopleButtons.current.delete(c.id))} onClick={() => setPeople((p) => ({ checkpoint: c, opened: (p?.opened ?? 0) + 1 }))}>
                        People
                      </button>
                      <button type="button" className={`${styles.secondary} ${styles.small}`} aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                        Edit
                      </button>
                      <button type="button" className={`${styles.danger} ${styles.small}`} aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {people && (
        <CheckpointPeople
          key={`${people.checkpoint.id}-${people.opened}`}
          slug={slug}
          checkpoint={people.checkpoint}
          timezone={timezone}
          onClose={() => {
            const id = people.checkpoint.id;
            setPeople(null);
            requestAnimationFrame(() => peopleButtons.current.get(id)?.focus());
          }}
        />
      )}
      {editing && (
        <CheckpointForm
          slug={slug}
          timezone={timezone}
          initial={editing === 'new' ? null : editing}
          onDone={async (msg) => {
            setEditing(null);
            setMessage(msg);
            await load();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body={<p>Checkpoints that already have scans can’t be deleted. Close them instead.</p>}
          confirmLabel="Delete checkpoint"
          danger
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function CheckpointForm(props: { slug: string; timezone: string; initial: Checkpoint | null; onDone: (msg: string) => void; onCancel: () => void }) {
  const api = useApi();
  const init = props.initial;
  const [name, setName] = useState(init?.name ?? '');
  const [kind, setKind] = useState<Kind>(init?.kind ?? 'session');
  const [capacity, setCapacity] = useState(init?.capacity?.toString() ?? '');
  const [requiresCheckin, setRequiresCheckin] = useState(init?.requiresCheckin ?? true);
  const [sortOrder, setSortOrder] = useState(init?.sortOrder.toString() ?? '0');
  const [startsAt, setStartsAt] = useState(init?.startsAt ? toLocalInput(init.startsAt, props.timezone) : '');
  const [error, setError] = useState<string | null>(null);
  const isDoor = kind === 'door';

  async function submit() {
    const cap = capacity.trim() === '' ? null : Number(capacity);
    if (cap !== null && (!Number.isInteger(cap) || cap <= 0)) return setError('Capacity must be a whole number above 0, or empty.');
    const body = {
      name,
      ...(init ? {} : { kind }),
      capacity: cap,
      requiresCheckin: isDoor ? false : requiresCheckin,
      sortOrder: Number(sortOrder) || 0,
      startsAt: startsAt ? zonedToUtc(startsAt, props.timezone) : null,
    };
    const r = init
      ? await api(adminUrl(props.slug, `/checkpoints/${init.id}`), { method: 'PATCH', body })
      : await api(adminUrl(props.slug, '/checkpoints'), { method: 'POST', body });
    if (!r.ok) return setError(ERROR_TEXT[r.data.error ?? ''] ?? (r.status === 400 ? 'Check the fields.' : errorText(r)));
    props.onDone(`✓ ${init ? 'Saved' : 'Added'} ${name}.${init ? '' : ' It starts closed.'}`);
  }

  return (
    <Modal title={init ? `Edit ${init.name}` : 'Add checkpoint'} onCancel={props.onCancel}>
      <form
        className={styles.dialogForm}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className={styles.field}>
          Name
          <input className={styles.input} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={styles.field}>
          Kind
          <select className={styles.input} value={kind} disabled={init !== null} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Capacity (optional)
          <input className={styles.input} inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={isDoor ? false : requiresCheckin} disabled={isDoor} onChange={(e) => setRequiresCheckin(e.target.checked)} /> Requires door check-in first
        </label>
        <label className={styles.field}>
          Starts ({props.timezone}, optional)
          <input className={styles.input} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className={styles.field}>
          Sort order
          <input className={styles.input} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </label>
        {error && (
          <p className={`${styles.alert} ${styles.alertBad}`} role="alert">
            ✕ {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.secondary} onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit">{init ? 'Save' : 'Add checkpoint'}</button>
        </div>
      </form>
    </Modal>
  );
}

interface ScanRow {
  id: string;
  displayName: string;
  isTest: boolean;
  scannedAt: string;
  method: 'qr' | 'manual' | 'nfc';
  scannedByName: string | null;
  canRemove: boolean;
}

const HOW: Record<ScanRow['method'], string> = { qr: 'QR', nfc: 'Badge', manual: 'Manual' };

// SPEC §11 (v0.8): who was scanned at a checkpoint, newest first. Remove voids the scan (F11, I-9): it stays
// in the history but stops counting, and the person can be scanned again.
function CheckpointPeople(props: { slug: string; checkpoint: Checkpoint; timezone: string; onClose: () => void }) {
  const api = useApi();
  const { slug, checkpoint } = props;
  const [rows, setRows] = useState<ScanRow[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<ScanRow | null>(null);
  const [removing, setRemoving] = useState(false); // one removal (and its refresh) at a time
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []); // the panel opens below the table: bring it into view

  const load = useCallback(async () => {
    const r = await api<{ scans: ScanRow[] }>(`/api/events/${encodeURIComponent(slug)}/checkpoints/${checkpoint.id}/scans`);
    if (r.ok) setRows(r.data.scans);
    else setMessage(`✕ ${errorText(r)}`);
  }, [api, slug, checkpoint.id]);

  useLoad(load);

  async function remove(row: ScanRow, reason: string) {
    setVoiding(null);
    setRemoving(true);
    const r = await api<{ code: string }>(`/api/scans/${row.id}/void`, { method: 'POST', body: { reason } });
    const done = r.ok && (r.data.code === 'VOIDED' || r.data.code === 'ALREADY_VOIDED');
    setMessage(done ? `✓ Removed ${row.displayName} from ${checkpoint.name}.` : `✕ ${r.ok ? `Couldn’t remove (${r.data.code}).` : errorText(r)}`);
    await load();
    setRemoving(false);
    heading.current?.focus(); // the row (and its button) is gone: keep keyboard focus on the panel
  }

  const headingId = `people-${checkpoint.id}`;
  return (
    <section aria-labelledby={headingId}>
      <div className={styles.toolbar}>
        <h2 id={headingId} ref={heading} tabIndex={-1}>
          People at {checkpoint.name}
        </h2>
        <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={props.onClose}>
          Close
        </button>
      </div>
      {message && (
        <p className={styles.alert + ' ' + (message.startsWith('✓') ? styles.alertOk : styles.alertWarn)} role="status">
          {message}
        </p>
      )}
      {rows === null ? (
        <p>Loading…</p>
      ) : (
        <>
          <p className={styles.muted}>
            {rows.length} {rows.length === 1 ? 'person' : 'people'}
          </p>
          {rows.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Scanned</th>
                    <th>By</th>
                    <th>How</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.displayName}
                        {r.isTest && <span className={styles.muted}> (test)</span>}
                      </td>
                      <td>{formatEventDateTime(r.scannedAt, props.timezone)}</td>
                      <td>{r.scannedByName ?? '—'}</td>
                      <td>{HOW[r.method]}</td>
                      <td>
                        <button
                          type="button"
                          className={`${styles.danger} ${styles.small}`}
                          aria-label={`Remove ${r.displayName}`}
                          disabled={removing}
                          onClick={() => setVoiding(r)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {voiding && (
        <VoidDialog what={`${voiding.displayName}’s ${checkpoint.name} scan`} onSubmit={(reason) => void remove(voiding, reason)} onCancel={() => setVoiding(null)} />
      )}
    </section>
  );
}

