// PLAN F25: the moment a leaderboard is computed for. With a refresh period the board only moves at
// each window boundary, counted from the event start in absolute milliseconds (DST-safe: a window is
// always N real minutes). A freeze stops it there. Pure.
export function leaderboardAsOf(o: { now: Date; startsAt: string | Date; refreshMinutes: number; frozenAt: string | Date | null }): {
  asOf: Date;
  nextRefreshAt: Date | null;
} {
  const frozen = o.frozenAt === null ? null : new Date(o.frozenAt);
  let asOf: Date;
  let next: Date | null;
  if (o.refreshMinutes <= 0) {
    asOf = o.now;
    next = null;
  } else {
    const start = new Date(o.startsAt).getTime();
    const window = o.refreshMinutes * 60_000;
    const elapsed = o.now.getTime() - start;
    if (elapsed < 0) {
      asOf = new Date(start);
      next = new Date(start);
    } else {
      asOf = new Date(start + Math.floor(elapsed / window) * window);
      next = new Date(asOf.getTime() + window);
    }
  }
  if (frozen) return { asOf: frozen < asOf ? frozen : asOf, nextRefreshAt: null };
  return { asOf, nextRefreshAt: next };
}
