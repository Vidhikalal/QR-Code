import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/server';
import { normalizeUid } from '@/lib/domain/badge';
import styles from './profile.module.css';

// SPEC §6.5: what a phone opens when it taps a badge. Public; badge_profile() returns only
// opted-in fields. `?tap` (on tags written by the earlier datathon-badges app) is ignored.
export const metadata: Metadata = {
  title: 'Badge · Passline',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

const profileSchema = z
  .discriminatedUnion('public', [
    z.object({ public: z.literal(false) }),
    z.object({ public: z.literal(true), firstName: z.string(), lastName: z.string(), linkedinUrl: z.string().nullable() }),
  ])
  .nullable();

export default async function BadgeProfilePage({ params }: { params: Promise<{ uid: string }> }) {
  await connection(); // per request: an opt-out must take effect on the next view
  const uid = normalizeUid((await params).uid);
  if (!uid) notFound();

  const { data, error } = await db().rpc('badge_profile', { p_uid: uid });
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
        {profile?.public === false && (
          <>
            <h1>This attendee hasn’t shared a profile</h1>
            <p>They can choose to share their name and LinkedIn from their pass page.</p>
          </>
        )}
        {profile?.public && (
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
