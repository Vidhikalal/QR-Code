import 'server-only';
import { db } from '@/lib/db/server';
import { route } from '@/lib/http/route';
import { createCodeSignIn } from './code-signin';
import { supabaseForRequest } from './session';

// One line per route file. supabaseForRequest writes the session cookie on a successful verify.
export function codeSignInRoute(name: 'sendCode' | 'verifyCode') {
  return route(async (request: Request) => createCodeSignIn({ db: db(), auth: async () => (await supabaseForRequest()).auth })[name](request));
}
