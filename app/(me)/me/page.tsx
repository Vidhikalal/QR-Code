import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { db } from '@/lib/db/server';
import { env } from '@/lib/env';
import { myPoints } from '@/lib/leaderboard/handlers';
import { profileView } from '@/lib/participant/handlers';
import { isInAppBrowser } from '@/lib/participant/in-app-browser';
import { currentParticipantId } from '@/lib/participant/server';
import styles from '../me.module.css';
import { MeActions } from './me-actions';
import { ProfileEditor } from './profile-editor';

export const metadata: Metadata = { title: 'My profile · Passline', robots: { index: false, follow: false } };

// PLAN §10.4. Reads only; never writes on GET (I-17). Edits go through PATCH /api/me/profile.
export default async function MePage() {
  const [participantId, h] = await Promise.all([currentParticipantId(), headers()]);
  const app = isInAppBrowser(h.get('user-agent'));
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
  const [me, points] = await Promise.all([profileView(db(), participantId, env().FEATURE_EXTRA_BADGE_ROLES), myPoints(db(), participantId, new Date())]);
  const ranks = [
    points.activityRank && `#${points.activityRank} in Activity`,
    points.networkingRank && `#${points.networkingRank} in Networking`,
  ].filter(Boolean);
  return (
    <main className={styles.page}>
      {app && (
        <p className={styles.banner} role="note">
          <span aria-hidden="true">⚠</span>
          <span>
            You’re in {app}’s built-in browser. Open this page in Safari or Chrome (use the ⋯ or share menu → “Open in browser”) so your badge
            recognizes you.
          </span>
        </p>
      )}
      <div className={styles.card}>
        <p className={styles.eyebrow}>{me.event.name}</p>
        <h1>Hi {me.firstName}</h1>
        <p className={styles.muted}>This is the profile people see when they tap your badge. You’re signed in on this device.</p>
        <p>
          <a href="/me/connections">My connections →</a>
        </p>
      </div>
      <div className={styles.card} data-testid="my-points">
        <h2>Your points</h2>
        <p>
          Activity: <strong>{points.activity} pts</strong> · Networking: <strong>{points.networking} pts</strong>
        </p>
        <p className={styles.muted}>
          {ranks.length > 0 ? `On the screen you’re ${ranks.join(' and ')}.` : 'Check in at sessions and connect with people to climb the leaderboard.'}
        </p>
      </div>
      <ProfileEditor initial={me} />
      <div className={styles.card}>
        <h2>Your sign-in</h2>
        <MeActions />
      </div>
    </main>
  );
}
