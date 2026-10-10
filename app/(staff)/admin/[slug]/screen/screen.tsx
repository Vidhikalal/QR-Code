'use client';

import Link from 'next/link';
import { formatEventTime } from '@/lib/domain/event-time';
import { BOARD_TITLE, useBoards, type Board } from '../boards';
import styles from './screen.module.css';

const MEDAL = ['🥇', '🥈', '🥉'];

// PLAN F25: the projector. Top 3 per board, moving only at each refresh window, stopped by Freeze.
export function Screen({ slug }: { slug: string }) {
  const { boards, error } = useBoards(slug, 3);
  const b = boards?.activity;
  const status = !b ? '' : b.frozenAt ? 'Final results' : b.nextRefreshAt ? `Next update at ${formatEventTime(b.nextRefreshAt, b.timezone)}` : 'Live';
  return (
    <div className={styles.screen} data-testid="projector">
      <Link href={`/admin/${slug}`} className={styles.back}>
        ← Dashboard
      </Link>
      {!boards ? (
        <p className={styles.status}>{error ? `✕ ${error}` : 'Loading…'}</p>
      ) : (
        <>
          <div className={styles.columns}>
            <Column board={boards.activity} />
            <Column board={boards.networking} />
          </div>
          <p className={styles.status} role="status">
            {status}
            {error && ` · ✕ ${error}`}
          </p>
        </>
      )}
    </div>
  );
}

function Column({ board }: { board: Board }) {
  return (
    <section className={styles.column} aria-labelledby={`board-${board.kind}`}>
      <h1 id={`board-${board.kind}`}>{BOARD_TITLE[board.kind]}</h1>
      {board.rows.length === 0 ? (
        <p className={styles.empty}>No points yet</p>
      ) : (
        <ol className={styles.list}>
          {board.rows.map((r) => (
            <li key={`${r.rank}-${r.displayName}`} data-testid={`row-${board.kind}`}>
              <span className={styles.rank} aria-label={`Rank ${r.rank}`}>
                {MEDAL[r.rank - 1] ?? `#${r.rank}`}
              </span>
              <span className={styles.name}>{r.displayName}</span>
              <span className={styles.points}>
                {r.points} <small>pts</small>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
