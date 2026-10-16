import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { normalizeUid } from '@/lib/domain/badge';
import { normalizeEmail } from '@/lib/domain/normalize';
import styles from './profile.module.css';

// SPEC §6.5: what a phone opens when it taps a badge. Only for a signed-in attendee or staff member
// of the badge's event (proxy.ts sends everyone else to /login first); badge_profile() decides and
// returns only opted-in fields. `?tap` (on tags written by the earlier datathon-badges app) is ignored.
export const metadata: Metadata = {
  title: 'Badge · Passline',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

const profileSchema = z
  .union([
    z.object({ allowed: z.literal(false) }),
    z.object({ allowed: z.literal(true), public: z.literal(false) }),
    z.object({
      allowed: z.literal(true),
      public: z.literal(true),
      firstName: z.string(),
      lastName: z.string(),
      linkedinUrl: z.string().nullable(),
    }),
  ])
  .nullable();

export default async function BadgeProfilePage({ params }: { params: Promise<{ uid: string }> }) {
  await connection(); // per request: an opt-out must take effect on the next view
  const raw = (await params).uid;
  const uid = normalizeUid(raw);
  if (!uid) notFound();
  const viewer = await currentUser();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/profile/${raw}`)}`);

  const { data, error } = await db().rpc('badge_profile', {
    p_uid: uid,
    p_viewer_id: viewer.id,
    p_viewer_email: normalizeEmail(viewer.email ?? ''),
  });
  if (error) throw new Error(`badge_profile failed (${error.code})`);
  const profile = profileSchema.parse(data);

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Event badge</p>
        {profile === null && (
          <>
            <h1>This badge isn’t linked yet</h1>
            <p>Badges are linked to their owner at event check-in.</p>
          </>
        )}
        {profile?.allowed === false && (
          <>
            <h1>Only people at this event can see this badge</h1>
            <p>
              You’re signed in as {viewer.email ?? 'an unknown address'}. Sign in with the email you registered for the
              event with.
            </p>
            <Link className={styles.link} href={`/login?next=${encodeURIComponent(`/profile/${raw}`)}`}>
              Use a different email
            </Link>
          </>
        )}
        {profile?.allowed && !profile.public && (
          <>
            <h1>This attendee hasn’t shared a profile</h1>
            <p>They can choose to share their name and LinkedIn from their pass page.</p>
          </>
        )}
        {profile?.allowed && profile.public && (
          <>
            <h1 className={styles.name}>{`${profile.firstName} ${profile.lastName}`.trim()}</h1>
            {profile.linkedinUrl ? (
              <a className={styles.link} href={profile.linkedinUrl} rel="noopener noreferrer">
                View LinkedIn profile
              </a>
            ) : (
              <p>No LinkedIn profile shared.</p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
