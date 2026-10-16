import { db } from '@/lib/db/server';
import { route } from '@/lib/http/route';
import { createPassHandler, createPassProfileHandler } from '@/lib/pass/handlers';

// SPEC §9.3: authenticated by the token in the body; 30 requests/min per IP.
export const POST = route((request) => createPassHandler({ db: db() })(request));
// §6.5 badge profile opt-in.
export const PATCH = route((request) => createPassProfileHandler({ db: db() })(request));
