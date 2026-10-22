import { after } from 'next/server';
import { landingAfterSignIn } from '@/lib/auth/onboarding';
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
    signIn: async (email, password) => {
      const { data, error } = await (await supabaseForRequest()).auth.signInWithPassword({ email, password });
      // An account with no password yet (unconfirmed) is told to reset it, like a wrong password.
      if (error) return error.code === 'invalid_credentials' || error.code === 'email_not_confirmed' ? 'wrong' : 'error';
      // F9: like /login, every sign-in grants admin roles, consumes staff invites and may need onboarding first.
      return { next: await landingAfterSignIn(db(), data.user, '/me', env().ADMIN_EMAILS) };
    },
    scheduleDrain: (task) => after(task),
    drain: () =>
      drainUntilIdle({ db: db(), provider: getProvider(), appOrigin: env().NEXT_PUBLIC_APP_ORIGIN, from: emailFrom(), passSecret: env().PASS_TOKEN_SECRET }),
  })(request),
);
