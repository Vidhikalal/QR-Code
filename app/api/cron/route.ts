import { bearerMatches } from '@/lib/auth/secret';
import { db } from '@/lib/db/server';
import { emailFrom, getProvider } from '@/lib/email';
import { drainUntilIdle } from '@/lib/email/drain';
import { env } from '@/lib/env';
import { route } from '@/lib/http/route';

// SPEC F4/F13 (v0.9): the scheduler's job every few minutes (Bearer DRAIN_SECRET only). Expire missed RSVP
// deadlines and queue due reminders, then send whatever is waiting, including retries of failed sends.
export const POST = route(async (request) => {
  if (!bearerMatches(request.headers.get('authorization'), env().DRAIN_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { data: jobs, error } = await db().rpc('run_rsvp_jobs', {});
  // Send whatever is waiting even if the jobs failed: retries must not stop with them.
  const claimed = await drainUntilIdle({
    db: db(),
    provider: getProvider(),
    appOrigin: env().NEXT_PUBLIC_APP_ORIGIN,
    passSecret: env().PASS_TOKEN_SECRET,
    from: emailFrom(),
  });
  if (error) throw new Error(`run_rsvp_jobs failed (${error.code})`);
  return Response.json({ jobs, claimed });
});
