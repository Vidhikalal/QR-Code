import 'server-only';
import { cookieAuthenticator } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { route } from '@/lib/http/route';
import { createEventsApi, type EventsApi } from './handlers';

// One line per route file: `export const POST = eventsRoute('createEvent');`
export function eventsRoute(name: keyof EventsApi) {
  return route(async (request: Request, ctx: { params: Promise<Record<string, string>> }) =>
    createEventsApi({ db: db(), authenticate: cookieAuthenticator })[name](request, await ctx.params),
  );
}
