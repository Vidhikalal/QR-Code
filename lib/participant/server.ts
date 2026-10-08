import 'server-only';
import { cookies } from 'next/headers';
import { after } from 'next/server';
import { db } from '@/lib/db/server';
import { emailFrom, getProvider } from '@/lib/email';
import { drainUntilIdle } from '@/lib/email/drain';
import { sha256hex } from '@/lib/domain/token';
import { env } from '@/lib/env';
import { route } from '@/lib/http/route';
import { createParticipantApi, type ParticipantApi } from './handlers';
import { isSessionValue, participantCookieName } from './session';

function participantApi(): ParticipantApi {
  const meOrigin = env().NEXT_PUBLIC_APP_ORIGIN;
  return createParticipantApi({
    db: db(),
    meOrigin,
    sessionDays: env().PARTICIPANT_SESSION_DAYS,
    scheduleDrain: () => after(() => drainUntilIdle({ db: db(), provider: getProvider(), appOrigin: meOrigin, from: emailFrom() })),
  });
}

// One line per route file: `export const POST = participantRoute('openSession');`
export function participantRoute(name: keyof ParticipantApi) {
  return route((request: Request) => participantApi()[name](request));
}

/** For server components on the ME host: the signed-in participant's id, or null. Never writes cookies. */
export async function currentParticipantId(): Promise<string | null> {
  const value = (await cookies()).get(participantCookieName(env().NEXT_PUBLIC_APP_ORIGIN))?.value;
  if (!isSessionValue(value)) return null;
  const { data, error } = await db().rpc('session_participant', { p_session_hash: sha256hex(value) });
  if (error) throw new Error(`session_participant failed (${error.code})`);
  return data;
}
