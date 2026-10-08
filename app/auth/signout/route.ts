import { redirectTo } from '@/lib/http/redirect';
import { supabaseForRequest } from '@/lib/auth/session';
import { route } from '@/lib/http/route';

export const POST = route(async () => {
  await (await supabaseForRequest()).auth.signOut();
  return redirectTo('/login', 303);
});
