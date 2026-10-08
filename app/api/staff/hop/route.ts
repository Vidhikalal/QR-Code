import { cookieAuthenticator } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { env } from '@/lib/env';
import { route } from '@/lib/http/route';
import { createHopApi } from '@/lib/staff/hop';

// PLAN F15: "My badge profile" (ADMIN host).
export const POST = route((request: Request) =>
  createHopApi({ db: db(), authenticate: cookieAuthenticator, meOrigin: env().NEXT_PUBLIC_APP_ORIGIN, extraRoles: env().FEATURE_EXTRA_BADGE_ROLES }).hop(request),
);
