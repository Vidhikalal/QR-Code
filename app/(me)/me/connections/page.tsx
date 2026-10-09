import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { db } from '@/lib/db/server';
import { currentParticipantId } from '@/lib/participant/server';
import styles from '../../me.module.css';

export const metadata: Metadata = { title: 'My connections · Passline', robots: { index: false, follow: false } };

const mineSchema = z.object({
  mutual: z.array(
    z.object({
      participantId: z.string(),
      displayName: z.string(),
      badgeRole: z.string(),
      linkedinUrl: z.string().nullable(),
      badgePublicId: z.string().nullable(),
      mutualAt: z.string(),
    }),
  ),
  pendingOut: z.number(),
});

const LINK_REL = 'noopener noreferrer nofollow ugc';

// PLAN §10.4 "My connections": mutual only (nickname, Organizer label, LinkedIn, their badge page),
// plus how many people haven't tapped back yet. Reads only (I-17); visible only to this person.
export default async function ConnectionsPage() {
  const participantId = await currentParticipantId();
  if (!participantId) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1>You’re not signed in</h1>
          <p>
            Open the <strong>Set up your profile</strong> link from your pass email.
          </p>
        </div>
      </main>
    );
  }
  const { data, error } = await db().rpc('my_connections', { p_participant_id: participantId });
  if (error) throw new Error(`my_connections failed (${error.code})`);
  const mine = mineSchema.parse(data);
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>
          <Link href="/me">← My profile</Link>
        </p>
        <h1>My connections</h1>
        {mine.pendingOut > 0 && (
          <p className={styles.muted} data-testid="pending-out">
            Waiting on {mine.pendingOut} {mine.pendingOut === 1 ? 'person' : 'people'} to tap you back.
          </p>
        )}
        {mine.mutual.length === 0 ? (
          <p>No connections yet. Tap someone’s badge and press Connect; it counts once they tap yours too.</p>
        ) : (
          <ul className={styles.connections}>
            {mine.mutual.map((c) => (
              <li key={c.participantId}>
                <div>
                  <strong>{c.displayName}</strong>
                  {c.badgeRole === 'organizer' && <span className={styles.label}>Organizer</span>}
                </div>
                <div className={styles.actions}>
                  {c.linkedinUrl && (
                    <a className="button" href={c.linkedinUrl} target="_blank" rel={LINK_REL}>
                      LinkedIn
                    </a>
                  )}
                  {c.badgePublicId && (
                    <Link className={styles.secondaryLink} href={`/t/${c.badgePublicId}`}>
                      View badge
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
