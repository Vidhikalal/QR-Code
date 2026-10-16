import { after } from 'next/server';
import { supabaseForRequest } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { emailFrom, getProvider } from '@/lib/email';
import { drainUntilIdle } from '@/lib/email/drain';
import { env } from '@/lib/env';
import { route } from '@/lib/http/route';
import { createRsvpHandler } from '@/lib/rsvp/handlers';

// SPEC F13, §9.3: authenticated by the RSVP token in the body; 30 requests/min per IP.
export const POST = route((request) =>
  createRsvpHandler({
    db: db(),
    signIn: async (email, password) => !(await (await supabaseForRequest()).auth.signInWithPassword({ email, password })).error,
    scheduleDrain: (task) => after(task),
    drain: () =>
      drainUntilIdle({ db: db(), provider: getProvider(), appOrigin: env().NEXT_PUBLIC_APP_ORIGIN, from: emailFrom(), passSecret: env().PASS_TOKEN_SECRET }),
  })(request),
);
