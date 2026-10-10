'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatEventDateTime } from '@/lib/domain/event-time';
import styles from './admin.module.css';
import { adminUrl, errorText, useApi } from './api';
import { ArrivalsChart, type ArrivalBucket } from './arrivals-chart';
import { BOARD_TITLE, useBoards } from './boards';
import { ConfirmDialog } from './dialog';

type Kind = 'door' | 'meal' | 'session' | 'custom';
interface DashboardData {
  event: { name: string; startsAt: string; endsAt: string; timezone: string };
  generatedAt: string;
  accepted: number;
  checkedIn: number;
  checkInRate: number;
  noShows: number;
  connections: { mutualPairs: number; averagePerCheckedIn: number; shareWithAny: number };
  checkpoints: Array<{
    id: string;
    name: string;
    kind: Kind;
    isOpen: boolean;
    capacity: number | null;
    liveScans: number;
    fill: number | null;
    uptake?: number | null;
    firstServings?: number;
    seconds?: number;
    secondsOpen?: boolean;
  }>;
  sessionRanking: Array<{ id: string; name: string; liveScans: number; capacity: number | null }>;
  arrivals: ArrivalBucket[];
  outbox: { pending: number; failed: number };
  alerts: { doorClosed: boolean; notFound: Array<{ staffUserId: string; displayName: string | null; count: number }> };
  scanProblems: Array<{ checkpointId: string | null; code: string; count: number }>;
}

const POLL_MS = 10_000; // SPEC §11
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n * 100)}%`);

export function Dashboard({ slug }: { slug: string }) {
  const api = useApi();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<DashboardData>(adminUrl(slug, '/dashboard'));
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else if (r.status !== 401) setError(errorText(r));
  }, [api, slug]);


  // PLAN F22: open seconds once everyone has had a first serving (same PATCH as the Checkpoints page).
  async function toggleSeconds(id: string, open: boolean) {
    await api(adminUrl(slug, `/checkpoints/${id}`), { method: 'PATCH', body: { secondsOpen: open } });
    await load();
  }
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  if (!data) return <p>{error ? `✕ ${error}` : 'Loading dashboard…'}</p>;
  const tz = data.event.timezone;
  const cpName = new Map(data.checkpoints.map((c) => [c.id, c.name]));

  return (
    <>
      <h1>Dashboard</h1>
      {error && (
        <p className={`${styles.alert} ${styles.alertWarn}`} role="status">
          ! Couldn’t refresh: {error} Showing data from {formatEventDateTime(data.generatedAt, tz)}.
        </p>
      )}
      {data.alerts.doorClosed && (
        <p className={`${styles.alert} ${styles.alertBad}`} role="alert">
          ⚠ The door is closed and the event starts {formatEventDateTime(data.event.startsAt, tz)}. Open it on the Checkpoints tab.
        </p>
      )}
      {data.alerts.notFound.map((a) => (
        <p key={a.staffUserId} className={`${styles.alert} ${styles.alertBad}`} role="alert">
          ⚠ {a.displayName ?? 'A staff member'} got {a.count} “unknown code” results in 5 minutes and is being rate-limited.
        </p>
      ))}
      {data.outbox.failed > 0 && (
        <p className={`${styles.alert} ${styles.alertWarn}`} role="alert">
          ! {data.outbox.failed} pass email{data.outbox.failed === 1 ? '' : 's'} failed to send. Resend from Participants.
        </p>
      )}

      <div className={styles.tiles}>
        <Tile id="accepted" label="Accepted" value={data.accepted} />
        <Tile id="checked-in" label="Checked in" value={data.checkedIn} hint={`${pct(data.checkInRate)} of accepted`} />
        <Tile id="no-shows" label="Not arrived" value={data.noShows} />
        <Tile id="outbox" label="Emails pending" value={data.outbox.pending} hint={`${data.outbox.failed} failed`} />
        <Tile
          id="connections"
          label="Connections made"
          value={data.connections.mutualPairs}
          hint={`${data.connections.averagePerCheckedIn} per person · ${pct(data.connections.shareWithAny)} have one`}
        />
      </div>

      <h2>Checkpoints</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Checkpoint</th>
              <th>Kind</th>
              <th>State</th>
              <th className={styles.num}>Scans</th>
              <th className={styles.num}>Fill</th>
              <th className={styles.num}>Meal uptake</th>
              <th className={styles.num}>First servings</th>
              <th className={styles.num}>Seconds</th>
              <th>Seconds open</th>
            </tr>
          </thead>
          <tbody>
            {data.checkpoints.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.kind}</td>
                <td>
                  <span className={`${styles.badge} ${c.isOpen ? styles.badgeOk : ''}`}>{c.isOpen ? '● Open' : '○ Closed'}</span>
                </td>
                <td className={styles.num}>
                  {c.liveScans}
                  {c.capacity ? ` / ${c.capacity}` : ''}
                </td>
                <td className={styles.num}>{pct(c.fill)}</td>
                <td className={styles.num}>{c.kind === 'meal' ? pct(c.uptake) : '—'}</td>
                <td className={styles.num}>{c.kind === 'meal' ? c.firstServings : '—'}</td>
                <td className={styles.num}>{c.kind === 'meal' ? c.seconds : '—'}</td>
                <td>
                  {c.kind === 'meal' ? (
                    <span className={styles.actions} style={{ alignItems: 'center' }}>
                      <span>{c.secondsOpen ? 'Open' : 'Ask first'}</span>
                      <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => void toggleSeconds(c.id, !(c.secondsOpen ?? false))}>
                        {c.secondsOpen ? 'Close seconds' : 'Open seconds'}
                      </button>
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Door arrivals per 15 minutes</h2>
      <ArrivalsChart buckets={data.arrivals} />

      {data.sessionRanking.length > 0 && (
        <>
          <h2>Session attendance</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Session</th>
                  <th className={styles.num}>Attended</th>
                  <th className={styles.num}>Capacity</th>
                </tr>
              </thead>
              <tbody>
                {data.sessionRanking.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className={styles.num}>{s.liveScans}</td>
                    <td className={styles.num}>{s.capacity ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Leaderboards slug={slug} />

      <h2>Scan problems</h2>
      {data.scanProblems.length === 0 ? (
        <p className={styles.muted}>None so far.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Checkpoint</th>
                <th>Result</th>
                <th className={styles.num}>Count</th>
              </tr>
            </thead>
            <tbody>
              {data.scanProblems.map((p) => (
                <tr key={`${p.checkpointId ?? ''}-${p.code}`}>
                  <td>{(p.checkpointId && cpName.get(p.checkpointId)) ?? '—'}</td>
                  <td>{p.code}</td>
                  <td className={styles.num}>{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.muted}>Updated {formatEventDateTime(data.generatedAt, tz)} · refreshes every 10 s</p>
    </>
  );
}

// PLAN F25: what the projector shows (top 5 here), Freeze/Unfreeze, and the projector link.
function Leaderboards({ slug }: { slug: string }) {
  const api = useApi();
  const { boards, error, reload } = useBoards(slug, 5);
  const [confirm, setConfirm] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const frozen = boards?.activity.frozenAt ?? null;

  async function setFrozen(value: boolean) {
    setConfirm(false);
    const r = await api(adminUrl(slug, '/leaderboard/freeze'), { method: 'POST', body: { frozen: value } });
    setFailed(r.ok ? null : errorText(r));
    await reload();
  }

  return (
    <section aria-labelledby="leaderboards-heading">
      <h2 id="leaderboards-heading">Leaderboards</h2>
      {!boards ? (
        <p className={styles.muted}>{error ? `✕ ${error}` : 'Loading…'}</p>
      ) : (
        <>
          <p className={styles.muted}>
            {frozen
              ? `Frozen at ${formatEventDateTime(frozen, boards.activity.timezone)}.`
              : boards.activity.nextRefreshAt
                ? `As on the screen (${formatEventDateTime(boards.activity.asOf, boards.activity.timezone)}). It updates every ${boards.activity.refreshMinutes} min.`
                : 'Live.'}
          </p>
          <div className={styles.tiles}>
            {(['activity', 'networking'] as const).map((k) => (
              <div key={k} className={styles.tile} data-testid={`board-${k}`}>
                <span className={styles.tileLabel}>{BOARD_TITLE[k]}</span>
                {boards[k].rows.length === 0 ? (
                  <span className={styles.tileHint}>No points yet</span>
                ) : (
                  <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                    {boards[k].rows.map((r) => (
                      <li key={`${r.rank}-${r.displayName}`} value={r.rank}>
                        {r.displayName} · {r.points} pts
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
          <div className={styles.actions} style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <a className={`button ${styles.small}`} href={`/admin/${encodeURIComponent(slug)}/screen`}>
              Open projector screen
            </a>
            {frozen ? (
              <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => void setFrozen(false)}>
                Unfreeze leaderboards
              </button>
            ) : (
              <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setConfirm(true)}>
                Freeze leaderboards
              </button>
            )}
          </div>
          {failed && (
            <p className={`${styles.alert} ${styles.alertBad}`} role="alert">
              ✕ {failed}
            </p>
          )}
        </>
      )}
      {confirm && (
        <ConfirmDialog
          title="Freeze the leaderboards?"
          body={<p>The screen stops changing and shows these as the final results. You can unfreeze later.</p>}
          confirmLabel="Freeze"
          onConfirm={() => void setFrozen(true)}
          onCancel={() => setConfirm(false)}
        />
      )}
    </section>
  );
}

function Tile(props: { id: string; label: string; value: number; hint?: string }) {
  return (
    <div className={styles.tile} data-testid={`kpi-${props.id}`}>
      <span className={styles.tileLabel}>{props.label}</span>
      <span className={styles.tileValue}>{props.value.toLocaleString('en-US')}</span>
      {props.hint && <span className={styles.tileHint}>{props.hint}</span>}
    </div>
  );
}
