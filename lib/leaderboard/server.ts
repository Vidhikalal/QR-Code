import 'server-only';
import { cookieAuthenticator } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { route } from '@/lib/http/route';
import { createLeaderboardApi, type LeaderboardApi } from './handlers';

// One line per route file: `export const GET = leaderboardRoute('get');`
export function leaderboardRoute(name: keyof LeaderboardApi) {
  return route(async (request: Request, ctx: { params: Promise<Record<string, string>> }) =>
    createLeaderboardApi({ db: db(), authenticate: cookieAuthenticator })[name](request, await ctx.params),
  );
}
