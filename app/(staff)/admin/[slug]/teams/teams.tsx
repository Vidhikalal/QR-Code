'use client';

import { useCallback, useState } from 'react';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi, useLoad, type ApiResult } from '../api';
import { ConfirmDialog } from '../dialog';

interface Track {
  id: string;
  name: string;
}
interface Team {
  id: string;
  name: string;
  code: string;
  trackId: string | null;
  members: Array<{ id: string; displayName: string; status: string }>;
}
interface Data {
  teamsOpen: boolean;
  tracksReleased: boolean;
  tracks: Track[];
  teams: Team[];
  unassigned: Array<{ id: string; displayName: string; looking: boolean }>;
}
type Deleting = { kind: 'teams' | 'tracks'; id: string; name: string };

const code = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;
const text = (f: FormData, k: string) => String(f.get(k) ?? '');

// SPEC §11 Teams (v0.7): organizers see and fix every team at any time; hackers form them while forming is open.
export function Teams({ slug }: { slug: string }) {
  const api = useApi();
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);

  const load = useCallback(async () => {
    const r = await api<Data>(adminUrl(slug, '/teams'));
    if (r.ok) setData(r.data);
    else setMessage(`✕ ${errorText(r)}`);
  }, [api, slug]);

  useLoad(load);

  async function done(r: ApiResult<unknown>, ok: string) {
    setMessage(r.ok ? `✓ ${ok}` : `✕ ${errorText(r)}`);
    await load();
    return r.ok;
  }
  const call = (path: string, method: string, body?: unknown) => api(adminUrl(slug, path), { method, body });

  // The switch flips at once; the reload after the PATCH shows what the server kept.
  async function setFlag(flag: 'teamsOpen' | 'tracksReleased', on: boolean, ok: string) {
    setData((d) => d && { ...d, [flag]: on });
    await done(await call('/event', 'PATCH', { [flag]: on }), ok);
  }

  async function remove(d: Deleting) {
    setDeleting(null);
    await done(await call(`/${d.kind}/${d.id}`, 'DELETE'), `Deleted ${d.name}.`);
  }

  if (!data) return message ? <p role="status">{message}</p> : <p>Loading…</p>;
  const looking = data.unassigned.filter((u) => u.looking).length;

  return (
    <>
      <h1>Teams</h1>
      {message && (
        <p className={styles.alert + ' ' + (message.startsWith('✓') ? styles.alertOk : styles.alertWarn)} role="status">
          {message}
        </p>
      )}
      <div className={styles.toolbar}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={data.teamsOpen}
            onChange={(e) => void setFlag('teamsOpen', e.target.checked, e.target.checked ? 'Team forming is open.' : 'Team forming is closed.')}
          />
          Team forming open
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={data.tracksReleased}
            onChange={(e) => void setFlag('tracksReleased', e.target.checked, e.target.checked ? 'Tracks released.' : 'Tracks hidden again.')}
          />
          Tracks released
        </label>
      </div>
      <p className={styles.muted}>
        {data.teams.length} teams. {data.unassigned.length} accepted hackers without a team ({looking} looking for one).
      </p>

      <h2>Tracks</h2>
      {data.tracks.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <tbody>
              {data.tracks.map((t) => (
                <tr key={t.id}>
                  <td>
                    <form
                      className={styles.actions}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void call(`/tracks/${t.id}`, 'PATCH', { name: text(new FormData(e.currentTarget), 'name') }).then((r) => done(r, 'Track renamed.'));
                      }}
                    >
                      <input name="name" aria-label={`Name of ${t.name}`} defaultValue={t.name} maxLength={100} required className={styles.input} style={{ flex: 1 }} />
                      <button type="submit" className={`${styles.secondary} ${styles.small}`}>
                        Rename
                      </button>
                      <button type="button" className={`${styles.danger} ${styles.small}`} aria-label={`Delete ${t.name}`} onClick={() => setDeleting({ kind: 'tracks', id: t.id, name: t.name })}>
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        style={{ display: 'grid', gap: 8, maxWidth: 560, marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          void call('/tracks', 'POST', { text: text(new FormData(form), 'text') }).then(async (r) => {
            if (await done(r, 'Tracks added.')) form.reset();
          });
        }}
      >
        <label className={styles.field}>
          Add tracks, one per line
          <textarea name="text" required className={styles.input} style={{ minHeight: 120, padding: 10 }} />
        </label>
        <div>
          <button type="submit">Add tracks</button>
        </div>
      </form>

      <h2>Teams</h2>
      <form
        className={styles.toolbar}
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          void call('/teams', 'POST', { name: text(f, 'name'), trackId: text(f, 'trackId') || null }).then(async (r) => {
            if (await done(r, 'Team created.')) form.reset();
          });
        }}
      >
        <label className={styles.field}>
          New team
          <input name="name" required maxLength={60} className={styles.input} />
        </label>
        <TrackSelect tracks={data.tracks} name="trackId" label="Track" value={null} />
        <button type="submit">Create team</button>
      </form>
      {data.teams.map((t) => (
        <section key={t.id} aria-label={`Team ${t.name}`} className={styles.tile} style={{ marginTop: 12 }}>
          <form
            className={styles.toolbar}
            onSubmit={(e) => {
              e.preventDefault();
              void call(`/teams/${t.id}`, 'PATCH', { name: text(new FormData(e.currentTarget), 'name') }).then((r) => done(r, 'Team renamed.'));
            }}
          >
            <label className={styles.field}>
              Team name
              <input name="name" defaultValue={t.name} required maxLength={60} className={styles.input} />
            </label>
            <button type="submit" className={`${styles.secondary} ${styles.small}`}>
              Rename
            </button>
            <span className={styles.muted}>Code {code(t.code)}</span>
            <button type="button" className={`${styles.danger} ${styles.small}`} onClick={() => setDeleting({ kind: 'teams', id: t.id, name: t.name })}>
              Delete team
            </button>
          </form>
          <TrackSelect
            tracks={data.tracks}
            label={`Track of ${t.name}`}
            value={t.trackId}
            onChange={(trackId) => void call(`/teams/${t.id}`, 'PATCH', { trackId }).then((r) => done(r, 'Track saved.'))}
          />
          <ul>
            {t.members.map((m) => (
              <li key={m.id} className={styles.actions} style={{ alignItems: 'center' }}>
                {m.displayName}
                {m.status !== 'accepted' && <span className={`${styles.badge} ${styles.badgeWarn}`}>{m.status}</span>}
                <button
                  type="button"
                  className={`${styles.secondary} ${styles.small}`}
                  aria-label={`Remove ${m.displayName} from ${t.name}`}
                  onClick={() => void call(`/participants/${m.id}`, 'PATCH', { teamId: null }).then((r) => done(r, `Removed ${m.displayName}.`))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {t.members.length < 4 && data.unassigned.length > 0 && (
            <form
              className={styles.toolbar}
              onSubmit={(e) => {
                e.preventDefault();
                const id = text(new FormData(e.currentTarget), 'participantId');
                void call(`/participants/${id}`, 'PATCH', { teamId: t.id }).then((r) => done(r, 'Member added.'));
              }}
            >
              <label className={styles.field}>
                Add to {t.name}
                <select name="participantId" required className={styles.input} defaultValue="">
                  <option value="" disabled>
                    Pick a hacker
                  </option>
                  {data.unassigned.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName}
                      {u.looking ? ' (looking)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={styles.small}>
                Add
              </button>
            </form>
          )}
        </section>
      ))}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body={<p>{deleting.kind === 'teams' ? 'Its members will be without a team.' : 'Teams that picked this track will have none.'}</p>}
          confirmLabel={deleting.kind === 'teams' ? 'Delete team' : 'Delete track'}
          danger
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function TrackSelect(props: { tracks: Track[]; label: string; value: string | null; name?: string; onChange?: (trackId: string | null) => void }) {
  return (
    <label className={styles.field}>
      {props.label}
      <select name={props.name} className={styles.input} defaultValue={props.value ?? ''} onChange={(e) => props.onChange?.(e.target.value || null)}>
        <option value="">No track</option>
        {props.tracks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
