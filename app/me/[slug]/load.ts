import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { myEvent } from '@/lib/me/profile';

export const menuMetadata = (title: string): Metadata => ({
  title: `${title} · Passline`,
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
});

// SPEC F14 (v0.6): every hacker-menu page is for the signed-in accepted attendee of that event (proxy.ts
// sends signed-out visitors to /login first); anyone else gets a 404.
export async function loadMyEvent(slug: string, path: string) {
  await connection(); // per request: own details, never cached
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  const me = await myEvent(db(), user.email ?? '', slug, new Date());
  if (!me) notFound();
  return { user, me };
}
