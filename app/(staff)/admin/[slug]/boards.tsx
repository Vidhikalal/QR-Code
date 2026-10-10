'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminUrl, errorText, useApi } from './api';

export type BoardKind = 'activity' | 'networking';
export interface Board {
  kind: BoardKind;
  asOf: string;
  nextRefreshAt: string | null;
  frozenAt: string | null;
  refreshMinutes: number;
  timezone: string;
  rows: Array<{ rank: number; displayName: string; points: number }>;
}

export const BOARD_TITLE: Record<BoardKind, string> = { activity: 'Activity', networking: 'Networking' };
const LIVE_POLL_MS = 10_000;
const MIN_WAIT_MS = 2_000; // a device clock ahead of the server must not refetch in a tight loop

// PLAN F25: both boards as of the projector's time. Refetches when the next refresh window opens,
// or every 10 s when the board is live (refresh 0). Frozen boards are still re-read every 10 s so an
// Unfreeze from another device shows up.
export function useBoards(slug: string, limit: number) {
  const api = useApi();
  const [boards, setBoards] = useState<Record<BoardKind, Board> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    const [a, n] = await Promise.all(
      (['activity', 'networking'] as const).map((k) => api<Board>(adminUrl(slug, `/leaderboard?kind=${k}&limit=${limit}`))),
    );
    if (a?.ok && n?.ok) {
      setBoards({ activity: a.data, networking: n.data });
      setError(null);
    } else {
      const bad = a && !a.ok ? a : n;
      if (bad && !bad.ok && bad.status !== 401) setError(errorText(bad));
    }
  }, [api, slug, limit]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load, tick]);

  const next = boards?.activity.nextRefreshAt ?? null;
  useEffect(() => {
    if (!boards) return;
    const wait = next ? Math.max(MIN_WAIT_MS, new Date(next).getTime() - Date.now() + 500) : LIVE_POLL_MS;
    const t = setTimeout(() => setTick((x) => x + 1), wait);
    return () => clearTimeout(t);
  }, [boards, next]);

  return { boards, error, reload: load };
}
