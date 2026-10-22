import { cookieAuthenticator } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { route } from '@/lib/http/route';
import { createCheckpointScansHandler } from '@/lib/scan/handlers';

export const GET = route(async (request, ctx: { params: Promise<{ slug: string; id: string }> }) =>
  createCheckpointScansHandler({ db: db(), authenticate: cookieAuthenticator })(request, await ctx.params),
);
