import 'server-only';
import { cookieAuthenticator } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { env } from '@/lib/env';
import { route } from '@/lib/http/route';
import { createTagsApi, type TagsApi } from './handlers';

// One line per route file: `export const POST = tagsRoute('reserve');`
export function tagsRoute(name: keyof TagsApi) {
  return route(async (request: Request, ctx: { params: Promise<Record<string, string>> }) =>
    createTagsApi({ db: db(), authenticate: cookieAuthenticator, meOrigin: env().NEXT_PUBLIC_APP_ORIGIN })[name](request, await ctx.params),
  );
}
