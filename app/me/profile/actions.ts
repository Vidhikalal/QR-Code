'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { saveBadgeProfile, type SaveProfileResult } from '@/lib/me/profile';

// The result and a count of successful saves, never the answers: Next logs server-action state in dev (I-11).
// The saved card shows the stored values through refresh(); the other card keeps what was typed (F14 step 3).
export type SaveState = { result: SaveProfileResult; saves: number } | null;

const text = (formData: FormData, key: string) => String(formData.get(key) ?? '');

const done = (prev: SaveState, result: SaveProfileResult): SaveState => {
  if (result === 'SAVED') refresh();
  return { result, saves: (prev?.saves ?? 0) + (result === 'SAVED' ? 1 : 0) };
};

// SPEC F14 (v0.9): profile setup after the RSVP Yes. The emergency contact, overnight and team status are
// required; allergies (with how severe, behind the toggle) and accessibility are optional. Only the organizers
// see them, and meal volunteers see the allergies.
export async function saveSetup(prev: SaveState, formData: FormData): Promise<SaveState> {
  const user = await currentUser();
  if (!user) redirect('/login?next=/me/profile');
  const result = await saveBadgeProfile(
    db(),
    user,
    text(formData, 'participantId'),
    {
      emergencyName: text(formData, 'emergencyName'),
      emergencyPhone: text(formData, 'emergencyPhone'),
      emergencyRelation: text(formData, 'emergencyRelation'),
      overnight: text(formData, 'overnight'),
      hasAllergies: formData.get('hasAllergies') === 'on',
      allergies: text(formData, 'allergies'),
      allergySeverity: text(formData, 'allergySeverity'),
      teamStatus: text(formData, 'teamStatus'),
      accessibility: text(formData, 'accessibility'),
    },
    { setup: true },
  );
  return done(prev, result);
}

// SPEC F14 / §6.5: the attendee's own LinkedIn, Discord username and website (v0.9.2), and badge sharing.
// Dietary notes come from the Sheet and only organizers see them (v0.8.2): no key here, so the stored notes stay.
export async function saveNetworking(prev: SaveState, formData: FormData): Promise<SaveState> {
  const user = await currentUser();
  if (!user) redirect('/login?next=/me/profile');
  const result = await saveBadgeProfile(db(), user, text(formData, 'participantId'), {
    linkedin: text(formData, 'linkedin'),
    discord: text(formData, 'discord'),
    website: text(formData, 'website'),
    profilePublic: formData.get('public') === 'on',
  });
  return done(prev, result);
}
