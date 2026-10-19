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

// SPEC F14 (v0.6.1): the signed-in person and their event (myEvent(); proxy.ts sends signed-out visitors to
// /login first). `me` is null for someone with no event: /me shows staff links, the other pages 404.
export async function loadMe(path: string) {
  await connection(); // per request: own details, never cached
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  return { user, me: await myEvent(db(), user.email ?? '', new Date()) };
}

export async function loadMyEvent(path: string) {
  const { user, me } = await loadMe(path);
  if (!me) notFound();
  return { user, me };
}
