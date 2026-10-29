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
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>EVENT MANAGEMENT</p>
          <h1>Teams &amp; tracks</h1>
          <p className={styles.muted}>
            Organize hackers, manage tracks, and monitor team formation.
          </p>
        </div>
        <div className={styles.headerMeta}>
          <span className={styles.badge}>
            {data.teamsOpen ? 'Formation open' : 'Formation closed'}
          </span>
        </div>
      </header>
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

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total teams</span>
          <strong className={styles.statValue}>{data.teams.length}</strong>
          <span className={styles.statHint}>Created for this event</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Unassigned hackers</span>
          <strong className={styles.statValue}>{data.unassigned.length}</strong>
          <span className={styles.statHint}>Accepted participants without a team</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Looking for a team</span>
          <strong className={styles.statValue}>{looking}</strong>
          <span className={styles.statHint}>May need help finding teammates</span>
        </div>
      </div>


      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>CONFIGURATION</p>
          <h2>Tracks</h2>
          <p className={styles.muted}>Manage the categories participants can choose for their teams.</p>
        </div>
        <span className={styles.badge}>{data.tracks.length} tracks</span>
      </div>
      {data.tracks.length > 0 && (
        <div className={styles.tracksTable}>
          <table className={styles.table}>
            <tbody>
              {data.tracks.map((t) => (
                <tr key={t.id}>
                  <td>
                    <TrackRow
  key={t.id}
  track={t}
  onRename={async (name) =>
    done(
      await call(`/tracks/${t.id}`, 'PATCH', { name }),
      'Track renamed.',
    )
  }
  onDelete={() =>
    setDeleting({ kind: 'tracks', id: t.id, name: t.name })
  }
/>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className={styles.addTracksForm}
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
          <input
  type="text"
  name="text"
  className={styles.addTrackInput}
  placeholder="Enter track name"
  maxLength={100}
  required
/>
        </label>
        <div>
          <button type="submit">Add tracks</button>
        </div>
      </form>

    <div className={styles.sectionHeading}>
  <div>
    <p className={styles.eyebrow}>TEAM MANAGEMENT</p>
    <h2>All teams</h2>
    <p className={styles.muted}>Create teams, assign tracks, and manage membership.</p>
  </div>
  <span className={styles.badge}>{data.teams.length} teams</span>
</div>
      <form
  className={`${styles.toolbar} ${styles.createTeamForm}`}
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
  <TeamCard
    key={t.id}
    t={t}
    tracks={data.tracks}
    unassigned={data.unassigned}
    call={call}
    done={done}
    setDeleting={setDeleting}
  />
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

function TrackRow({
  track,
  onRename,
  onDelete,
}: {
  track: Track;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(track.name);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    if (trimmed === track.name) {
      setEditing(false);
      return;
    }

    if (await onRename(trimmed)) {
      setEditing(false);
    }
  }

  return (
    <form className={styles.trackRow} onSubmit={save}>
      <input
        name="name"
        aria-label={`Name of ${track.name}`}
        value={name}
        readOnly={!editing}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        required
        className={`${styles.trackNameInput} ${
          editing ? styles.trackNameEditing : ''
        }`}
        style={{ flex: 1 }}
      />

      {editing ? (
        <>
          <button type="submit" className={`${styles.secondary} ${styles.small}`}>
            Save
          </button>
          <button
            type="button"
            className={`${styles.secondary} ${styles.small}`}
            onClick={() => {
              setName(track.name);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          className={`${styles.secondary} ${styles.small}`}
          onClick={() => setEditing(true)}
        >
          Rename
        </button>
      )}

      <button
        type="button"
        className={`${styles.danger} ${styles.small}`}
        aria-label={`Delete ${track.name}`}
        onClick={onDelete}
      >
        Delete
      </button>
    </form>
  );
}
type TeamCardProps = {
  t: Team;
  tracks: Track[];
  unassigned: Data['unassigned'];
  call: (path: string, method: string, body?: unknown) => Promise<ApiResult<unknown>>;
  done: (r: ApiResult<unknown>, ok: string) => Promise<boolean>;
  setDeleting: (d: Deleting) => void;
};

function TeamCard({
  t,
  tracks,
  unassigned,
  call,
  done,
  setDeleting,
}: TeamCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(t.name);
  const [editingTrack, setEditingTrack] = useState(false);
  const [draftTrack, setDraftTrack] = useState(t.trackId ?? '');

  const currentTrack = tracks.find((track) => track.id === t.trackId);

  return (
    <section
      aria-label={`Team ${t.name}`}
      className={`${styles.tile} ${styles.teamCard}`}
    >
      <button
        type="button"
        className={styles.teamToggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span>{t.name}</span>
        <span>{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className={styles.teamDetails}>
          <form
            className={styles.teamHeaderForm}
            onSubmit={async (e) => {
              e.preventDefault();

              const ok = await done(
                await call(`/teams/${t.id}`, 'PATCH', {
                  name: draftName.trim(),
                }),
                'Team renamed.',
              );

              if (ok) setEditingName(false);
            }}
          >
            <label className={styles.field}>
              Team name
              <input
                name="name"
                value={draftName}
                readOnly={!editingName}
                onChange={(e) => setDraftName(e.target.value)}
                required
                maxLength={60}
                className={styles.input}
              />
            </label>

            {editingName ? (
              <>
                <button type="submit" className={styles.small}>
                  Save
                </button>
                <button
                  type="button"
                  className={`${styles.secondary} ${styles.small}`}
                  onClick={() => {
                    setDraftName(t.name);
                    setEditingName(false);
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`${styles.secondary} ${styles.small}`}
                onClick={() => setEditingName(true)}
              >
                Rename
              </button>
            )}

            <span className={`${styles.teamCode} ${styles.muted}`}>
              TEAM CODE <strong>{code(t.code)}</strong>
            </span>

            <button
              type="button"
              className={`${styles.danger} ${styles.small}`}
              onClick={() =>
                setDeleting({ kind: 'teams', id: t.id, name: t.name })
              }
            >
              Delete team
            </button>
          </form>

          <div className={styles.teamTrack}>
            <span className={styles.field}>
              Track: {currentTrack?.name ?? 'No track'}
            </span>

            {!editingTrack ? (
              <button
                type="button"
                className={`${styles.secondary} ${styles.small}`}
                onClick={() => {
                  setDraftTrack(t.trackId ?? '');
                  setEditingTrack(true);
                }}
              >
                Change track
              </button>
            ) : (
              <form
                className={styles.trackEditForm}
                onSubmit={async (e) => {
                  e.preventDefault();

                  const ok = await done(
                    await call(`/teams/${t.id}`, 'PATCH', {
                      trackId: draftTrack || null,
                    }),
                    'Track saved.',
                  );

                  if (ok) setEditingTrack(false);
                }}
              >
                <select
                  className={styles.input}
                  value={draftTrack}
                  onChange={(e) => setDraftTrack(e.target.value)}
                >
                  <option value="">No track</option>
                  {tracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.name}
                    </option>
                  ))}
                </select>

                <button type="submit" className={styles.small}>
                  Save
                </button>
                <button
                  type="button"
                  className={`${styles.secondary} ${styles.small}`}
                  onClick={() => setEditingTrack(false)}
                >
                  Cancel
                </button>
              </form>
            )}
          </div>

          {t.members.length > 0 && (
            <ul className={styles.memberList}>
              {t.members.map((m) => (
                <li key={m.id} className={styles.memberRow}>
                  <span>{m.displayName}</span>

                  {m.status !== 'accepted' && (
                    <span className={`${styles.badge} ${styles.badgeWarn}`}>
                      {m.status}
                    </span>
                  )}

                  <button
                    type="button"
                    className={`${styles.secondary} ${styles.small}`}
                    aria-label={`Remove ${m.displayName} from ${t.name}`}
                    onClick={() =>
                      void call(`/participants/${m.id}`, 'PATCH', {
                        teamId: null,
                      }).then((r) => done(r, `Removed ${m.displayName}.`))
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {t.members.length < 4 && unassigned.length > 0 && (
            <form
              className={styles.addMemberForm}
              onSubmit={(e) => {
                e.preventDefault();
                const id = text(
                  new FormData(e.currentTarget),
                  'participantId',
                );

                void call(`/participants/${id}`, 'PATCH', {
                  teamId: t.id,
                }).then((r) => done(r, 'Member added.'));
              }}
            >
              <label className={styles.field}>
                Add member
                <select
                  name="participantId"
                  required
                  className={styles.input}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Pick a hacker
                  </option>
                  {unassigned.map((u) => (
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
        </div>
      )}
    </section>
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
