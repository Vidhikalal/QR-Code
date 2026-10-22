import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';

// /admin opens the newest event you organize (each event's pages check the role again); anyone else
// goes to /me. Signed-out visitors are sent to /login first by proxy.ts.
export default async function AdminIndexPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/admin');
  const { data, error } = await db()
    .from('events')
    .select('slug, event_staff!inner(user_id, role)')
    .eq('event_staff.user_id', user.id)
    .eq('event_staff.role', 'organizer')
    .order('starts_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`organizer events lookup failed (${error.code})`);
  redirect(data[0] ? `/admin/${data[0].slug}` : '/me');
}
