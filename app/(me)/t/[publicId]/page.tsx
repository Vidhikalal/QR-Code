import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicProfileCard } from '@/components/public-profile-card';
import { loadBadgePage } from '@/lib/badge/handlers';
import { cookieAuthenticator } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { env } from '@/lib/env';
import styles from './badge.module.css';
import { ConnectButton } from './connect';
import { AssignPanel, OwnerActions, StaffPanel } from './panels';

export const metadata: Metadata = { title: 'Badge · Passline', referrer: 'no-referrer', robots: { index: false, follow: false } };

// PLAN §8: what someone sees when they tap a badge. Server-rendered from badgeView() (the pure "who sees
// what" matrix). GET never changes event state (I-17); every action is a POST from a button.
export default async function BadgePage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const h = await headers();
  const view = await loadBadgePage({
    db: db(),
    publicId,
    request: new Request(`${env().NEXT_PUBLIC_APP_ORIGIN}/t/${publicId}`, { headers: { cookie: h.get('cookie') ?? '' } }),
    authenticate: cookieAuthenticator,
    meOrigin: env().NEXT_PUBLIC_APP_ORIGIN,
    extraRoles: env().FEATURE_EXTRA_BADGE_ROLES,
    now: new Date(),
  });
  if (view.kind === 'not_found') notFound();

  return (
    <main className={styles.page}>
      {view.kind === 'used' && (
        <div className={styles.card}>
          <h1>This badge was used at {view.eventName}.</h1>
          {view.profileDeletedOn && <p className={styles.muted}>Staff: profile deleted on {new Date(view.profileDeletedOn).toDateString()}.</p>}
        </div>
      )}

      {view.kind === 'retired' && (
        <div className={styles.card}>
          <p className={styles.eyebrow}>{view.eventName}</p>
          {view.replacementLabel ? <h1>This badge was replaced. Your new one is {view.replacementLabel}.</h1> : <h1>This badge is no longer active.</h1>}
          {view.staff && (
            <p className={styles.note} data-testid="staff-retired">
              Staff: deactivated {new Date(view.staff.retiredAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.{' '}
              {view.staff.current ? `Current badge: ${view.staff.current.label} (${view.staff.current.holderName}).` : 'No current badge.'}
            </p>
          )}
        </div>
      )}

      {view.kind === 'unlinked' &&
        (view.staff ? (
          <AssignPanel publicId={publicId} eventSlug={view.staff.eventSlug} tagLabel={view.staff.tagLabel} suggestion={view.staff.suggestion} />
        ) : (
          <div className={styles.card}>
            <p className={styles.eyebrow}>{view.eventName}</p>
            <h1>This badge isn’t activated yet.</h1>
            <p className={styles.muted}>Staff link badges at the door.</p>
          </div>
        ))}

      {view.kind === 'linked' && (
        <>
          {view.staff && <StaffPanel panel={view.staff} />}
          {view.audience === 'owner' && (
            <div className={styles.card}>
              <h2>Your badge</h2>
              {view.ownerOnlyNote && <p className={styles.note}>Your profile is hidden. Only you can see this.</p>}
              <OwnerActions />
            </div>
          )}
          {view.staff && <p className={styles.muted}>Staff view: every field, including what they keep to organizers.</p>}
          <PublicProfileCard profile={view.staff ? view.staff.profile : view.profile} />
          {view.connect && <ConnectButton publicId={publicId} name={view.profile.displayName} state={view.connect.state} />}
          {view.audience === 'anonymous' && (
            <div className={styles.actions}>
              <Link className="button" href="/signin">
                Sign in to connect
              </Link>
            </div>
          )}
        </>
      )}
    </main>
  );
}
