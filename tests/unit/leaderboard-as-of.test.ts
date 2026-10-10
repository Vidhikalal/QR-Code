import { describe, expect, it } from 'vitest';
import { leaderboardAsOf } from '@/lib/leaderboard/as-of';

const at = (iso: string) => new Date(iso);
const START = '2026-10-03T13:00:00Z'; // 09:00 EDT

describe('leaderboardAsOf (PLAN F25)', () => {
  it('T-LB-01: refresh 0 is live: as of now, no scheduled refresh', () => {
    const now = at('2026-10-03T15:12:34Z');
    expect(leaderboardAsOf({ now, startsAt: START, refreshMinutes: 0, frozenAt: null })).toEqual({ asOf: now, nextRefreshAt: null });
  });

  it('T-LB-01: refresh 60 from a 09:00 start: 10:59:59 → 10:00; 11:00:00 → 11:00', () => {
    expect(leaderboardAsOf({ now: at('2026-10-03T14:59:59Z'), startsAt: START, refreshMinutes: 60, frozenAt: null })).toEqual({
      asOf: at('2026-10-03T14:00:00Z'),
      nextRefreshAt: at('2026-10-03T15:00:00Z'),
    });
    expect(leaderboardAsOf({ now: at('2026-10-03T15:00:00Z'), startsAt: START, refreshMinutes: 60, frozenAt: null }).asOf).toEqual(at('2026-10-03T15:00:00Z'));
    expect(leaderboardAsOf({ now: at('2026-10-03T13:20:00Z'), startsAt: START, refreshMinutes: 15, frozenAt: null })).toEqual({
      asOf: at('2026-10-03T13:15:00Z'),
      nextRefreshAt: at('2026-10-03T13:30:00Z'),
    });
  });

  it('T-LB-01: frozen before the current window → the freeze time, and no more refreshes', () => {
    expect(leaderboardAsOf({ now: at('2026-10-03T18:30:00Z'), startsAt: START, refreshMinutes: 60, frozenAt: at('2026-10-03T16:20:00Z') })).toEqual({
      asOf: at('2026-10-03T16:20:00Z'),
      nextRefreshAt: null,
    });
    // Frozen after the window start: the window start still wins (the board doesn't jump forward).
    expect(leaderboardAsOf({ now: at('2026-10-03T18:30:00Z'), startsAt: START, refreshMinutes: 60, frozenAt: at('2026-10-03T18:20:00Z') }).asOf).toEqual(at('2026-10-03T18:00:00Z'));
  });

  it('T-LB-01: across the 2026-11-01 DST change, windows are absolute UTC hours', () => {
    const start = '2026-11-01T02:00:00Z'; // 22:00 EDT on Oct 31
    // 01:30 EDT (05:30Z) and 01:30 EST (06:30Z) fall in different windows: 05:00Z and 06:00Z.
    expect(leaderboardAsOf({ now: at('2026-11-01T05:30:00Z'), startsAt: start, refreshMinutes: 60, frozenAt: null }).asOf).toEqual(at('2026-11-01T05:00:00Z'));
    expect(leaderboardAsOf({ now: at('2026-11-01T06:30:00Z'), startsAt: start, refreshMinutes: 60, frozenAt: null }).asOf).toEqual(at('2026-11-01T06:00:00Z'));
  });

  it('T-LB-01: before the start, the board is as of the start', () => {
    expect(leaderboardAsOf({ now: at('2026-10-03T12:00:00Z'), startsAt: START, refreshMinutes: 60, frozenAt: null })).toEqual({
      asOf: at(START),
      nextRefreshAt: at(START),
    });
  });
});
