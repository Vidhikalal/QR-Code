import { cookieAuthenticator } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { env } from '@/lib/env';
import { route } from '@/lib/http/route';
import { createSigninCodeApi } from '@/lib/participant/signin-code';

// PLAN F18 / I-23: staff hand-off sign-in code. Served on both hosts (badge page later, V4).
export const POST = route(async (request: Request, ctx: { params: Promise<Record<string, string>> }) =>
  createSigninCodeApi({ db: db(), authenticate: cookieAuthenticator, meOrigin: env().NEXT_PUBLIC_APP_ORIGIN }).issue(request, await ctx.params),
);
