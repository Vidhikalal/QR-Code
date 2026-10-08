import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { db } from '@/lib/db/server';
import { participantSummary } from '@/lib/participant/handlers';
import { isInAppBrowser } from '@/lib/participant/in-app-browser';
import { currentParticipantId } from '@/lib/participant/server';
import styles from '../me.module.css';
import { MeActions } from './me-actions';

export const metadata: Metadata = { title: 'My profile · Passline', robots: { index: false, follow: false } };

// PLAN §10.4 (minimal for V2a; the profile form arrives in V3). Reads only; never writes on GET (I-17).
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
  const me = await participantSummary(db(), participantId);
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
        <p className={styles.muted}>Your profile page is coming soon. You’re signed in on this device.</p>
        <MeActions />
      </div>
    </main>
  );
}
