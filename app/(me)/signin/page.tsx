import type { Metadata } from 'next';
import { db } from '@/lib/db/server';
import { signinEvents } from '@/lib/events/queries';
import { SigninView } from './signin-view';

export const metadata: Metadata = { title: 'Sign in · Passline', referrer: 'no-referrer', robots: { index: false, follow: false } };

// PLAN F18 / §10.4. Reads only (I-17). Lists recent and upcoming events by name so a participant can
// pick theirs; nothing about people is shown.
export default async function SigninPage() {
  return <SigninView events={await signinEvents(db())} />;
}
